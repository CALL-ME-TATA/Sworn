"""The orchestrator agent, as a LangGraph state machine:

hire -> plan -> retrieve -> read -> reason -> verify -> generate -> record
                  any step whose agent fails -> replace -> back to that step (or record if no backup is left)

Every agent, ours or third-party, is reached over HTTP and screened before it is hired.
Usage: python -m app.orchestrator "your question" [--kill] [--no-feedback]"""
import asyncio
import re
import sys
import time
from datetime import datetime, timezone
from typing import TypedDict

import httpx
from langgraph.graph import END, START, StateGraph

from . import bench, llm, metrics, store, trust
from .config import CONFIG, REASONING, ROLES
from .llm import ask
from .registry import discover, get_score, give_feedback, is_alive, operator_wallets, registry_stats
from .sources import seed_cache

_http = httpx.AsyncClient()


def cited_ids(answer: str) -> list[str]:
    return re.findall(r"\[(c\d+)\]", answer or "")


def split_citations(answer: str) -> str:
    """Models sometimes group citations ("[c1 c2]", "[c1, c2]"); write them one per bracket, as the rest expects."""
    return re.sub(r"\[(c\d+(?:[\s,;]+c\d+)+)\]", lambda m: "".join(f"[{x}]" for x in re.findall(r"c\d+", m[1])), answer or "")


class AgentError(Exception):
    """hard = the agent is down (unreachable, 5xx, timeout); soft = it answered badly."""

    def __init__(self, message: str, hard: bool):
        super().__init__(message)
        self.hard = hard


class AgentBusy(Exception):
    """The agent answered 429: its AI provider (or the agent itself) is rate-limited. Not a fault, so never scored."""


BUSY = "AI provider limit reached"


class AgentDown(Exception):
    def __init__(self, role: str):
        super().__init__(f"{role} agent down")
        self.role = role


SHAPES = {
    "planner": lambda o: isinstance(o.get("subquestions"), list) and len(o["subquestions"]) > 0
    and all(isinstance(s, dict) and s.get("question") for s in o["subquestions"]),
    "retriever": lambda o: isinstance(o.get("sources"), list) and all(isinstance(s, dict) and s.get("url") for s in o["sources"]),
    "reader": lambda o: isinstance(o.get("facts"), list) and all(isinstance(f, dict) and f.get("quote") and f.get("source_url") for f in o["facts"]),
    "reasoner": lambda o: isinstance(o.get("claims"), list)
    and all(isinstance(c, dict) and c.get("text") and c.get("quote") and c.get("source_url") for c in o["claims"]),
    "verifier": lambda o: o.get("verdict") in ("supported", "unsupported", "unreachable"),
    "generator": lambda o: isinstance(o.get("answer"), str) and o["answer"].strip() != "",
}


async def post(endpoint: str, body: dict, timeout: float) -> dict:
    try:
        res = await _http.post(endpoint, json=body, timeout=timeout)
    except httpx.TimeoutException:
        raise AgentError("timeout", True) from None
    except httpx.HTTPError:
        raise AgentError("unreachable", True) from None
    if res.status_code == 429:
        try:
            detail = res.json().get("error") or "rate limited"
        except Exception:  # noqa: BLE001
            detail = "rate limited"
        raise AgentBusy(detail)
    if 300 <= res.status_code < 400:  # an agent's registered address must answer itself, not send us elsewhere
        raise AgentError(f"HTTP {res.status_code} redirect (agent moved)", True)
    if res.status_code >= 500 or res.status_code in (404, 410):  # 410: the agent has moved or shut down
        raise AgentError("HTTP 410 gone (agent moved or shut down)" if res.status_code == 410 else f"HTTP {res.status_code}", True)
    if res.status_code >= 400:
        raise AgentError(f"HTTP {res.status_code}", False)
    try:
        out = res.json().get("output")
    except Exception:  # noqa: BLE001
        raise AgentError("reply is not JSON", False) from None
    if not isinstance(out, dict):
        raise AgentError("reply has no output", False)
    return out


async def clarify(question: str, not_found: bool = False) -> dict:
    """Before a run: is the question clear enough to research? After a run that found nothing: what to ask instead?
    Returns {clear: True} or {clear: False, ask, options: [{label, question}]}."""
    if not CONFIG.LLM:
        return {"clear": True}
    where = "Wikipedia and the web" if CONFIG.WEB else "Wikipedia"
    if not_found:
        prompt = (f'A research system searched {where} for this question and found little or nothing that answers it:\n"{question}"\n\n'
                  "Suggest 2 or 3 different questions the user could ask instead that are more likely to be answered: the closest broader "
                  "question, the official name of the event or product, or a more specific detail (a model, a year, a place). "
                  "Do not just reword the original question. "
                  'Set "ask" to one short sentence to the user saying what was probably missing, '
                  'for example "No source gave a single typical price for that."\n')
    else:
        prompt = (f'Decide whether this research question is clear enough to answer from {where}:\n"{question}"\n\n'
                  "Only treat it as unclear if it could mean clearly different things that would change the answer (an ambiguous name, "
                  'an event with several editions, a missing year or place that matters). Most questions are clear: then reply {"clear": true}.\n'
                  'If it is unclear, set "ask" to one short question for the user, and give 2 or 3 options, each a complete rewritten question.\n')
    res = await ask(prompt + 'Reply with JSON only: {"clear": true|false, "ask": "...", "options": [{"label": "short label", "question": "full question"}]}', json_mode=True)
    options = [{"label": str(o.get("label") or o["question"])[:80], "question": str(o["question"])[:300]}
               for o in res.get("options") or [] if isinstance(o, dict) and o.get("question")
               and o["question"].strip().lower() != question.strip().lower()][:3]
    if (res.get("clear") and not not_found) or not options:
        return {"clear": True}
    return {"clear": False, "ask": str(res.get("ask") or "Which one do you mean?")[:200], "options": options}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class State(TypedDict, total=False):
    failure: str | None  # role whose agent just went down
    resume: str | None   # step to go back to once a backup is in place
    error: str | None    # stops the run; the record step still writes feedback


class Run:
    def __init__(self, question: str, *, feedback=True, kill=False, log=print, latest=True, length="medium", reasoning="standard"):
        run_id = f"run_{int(time.time() * 1000)}"
        self.r = {
            "run_id": run_id, "question": question, "started_at": now(), "length": length, "reasoning": reasoning,
            "mode": f"{CONFIG.PROVIDER} · {CONFIG.MODEL}" if CONFIG.LLM else "rule-based",
            "registry": None, "plan": [], "tasks": [], "hiring": [], "team": {}, "claims": [], "answer": None,
            "failovers": [], "dead": [], "feedback": [], "metrics": {},
            "timings": {}, "calls": [], "kill": None, "round_trip_ms": None,
        }
        self.feedback, self.kill, self.log, self.latest = feedback, kill, log, latest
        self.report_url = f"{CONFIG.AGENTS_BASE_URL}/api/runs/{run_id}"
        self.stats: dict[tuple, dict] = {}  # (asset, role) -> record used for feedback
        self.team: dict[str, list[dict]] = {}
        self.dead: set[str] = set()
        self.pending_failover = None
        self.benchmarked: list[tuple[dict, str, dict]] = []  # fresh benchmark results, published on-chain at the end
        self.killed = None  # the agent the kill demo took offline; always revived before the run ends
        self._save_lock = asyncio.Lock()
        self.t0 = time.monotonic()

    def ms(self, t: float | None = None) -> int:
        """Milliseconds since the run started (or at monotonic time t)."""
        return int(((t if t is not None else time.monotonic()) - self.t0) * 1000)

    async def save(self):
        async with self._save_lock:
            await store.save_run(self.r, self.latest)

    def touch(self, agent: dict, role: str) -> dict:
        key = (agent["asset"], role)
        if key not in self.stats:
            self.stats[key] = {"name": agent["name"], "role": role, "endpoint": agent["endpoint"], "ours": agent["ours"],
                               "registry": agent.get("registry", "8004"), "ok": 0, "fail": 0, "streak": 0, "claims": 0,
                               "unsupported": 0, "outcome": "passed"}
        return self.stats[key]

    # ---------- hire ----------
    async def screen(self, agent: dict, role: str):
        entry = {"asset": agent["asset"], "id": agent.get("id", agent["asset"]), "protocol": agent.get("protocol", "a2a"), "name": agent["name"], "role": role, "ours": agent["ours"], "registry": agent.get("registry", "8004"),
                 "stage": "reputation", "result": "checking", "reason": None, "score": None, "ratings": 0}
        self.r["hiring"].append(entry)

        def reject(stage, reason, outcome=None):
            entry.update(stage=stage, result="failed", reason=reason)
            metrics.SCREENED.labels(role, "failed", stage).inc()
            if outcome:  # we interacted with it, so it gets feedback
                self.touch(agent, role).update(outcome=outcome, fail=1)
            return None

        # Only independent ratings count: none from the agent's own operator (for our agents, none from us), and on 8004
        # none the fake-reputation detector flags (app/trust.py). Until its first read of the registry, the direct read.
        operator = await operator_wallets(agent)
        rep = (trust.agent_score(agent["asset"], operator) if entry["registry"] == "8004" and trust.ready()
               else await get_score(agent["asset"], entry["registry"], operator))
        entry["score"], entry["ratings"] = (rep or {}).get("average"), (rep or {}).get("count", 0)
        entry["self_ratings"], entry["ignored"] = (rep or {}).get("self_count", 0), (rep or {}).get("ignored")
        if rep and rep["count"] >= CONFIG.MIN_FEEDBACKS and rep["average"] < CONFIG.MIN_SCORE:
            return reject("reputation", f"independent average {rep['average']} over {rep['count']} ratings")

        entry["stage"] = "alive"
        await self.save()
        if not await is_alive(agent):
            return reject("alive", "endpoint not responding", "dead")

        if agent.get("protocol") == "mcp":
            # A live MCP server, but Sworn hands out work in its own task format and does not call MCP tools yet.
            # Not the agent's fault, so no on-chain score; it is shown with the tools it does offer.
            tools = [t.get("name", "?") for t in agent.get("tools") or []]
            entry["tools"] = tools[:12]
            return reject("trial", f"live MCP server with {len(tools)} tools ({', '.join(tools[:3])}{', …' if len(tools) > 3 else ''}); "
                                   "none takes a Sworn task, so it can't do this job")

        # The standard benchmark (app/bench.py): the same items, aspects and grading for every candidate in the role.
        # One result per agent per day; everyone benchmarked that day gets the same sample of items.
        entry["stage"] = "trial"
        await self.save()
        started = time.monotonic()
        day = datetime.now(timezone.utc).date()
        report = await store.todays_benchmark(agent["asset"], role, bench.VERSION, day)
        cached = report is not None
        if cached and not report.get("tx") and self.feedback:
            self.benchmarked.append((agent, role, report))  # measured earlier without writing on-chain: publish it now
        if not cached:
            async def call(inp):
                t = time.monotonic()
                try:
                    out = await post(agent["endpoint"], {"run_id": self.r["run_id"], "task_id": "benchmark", "role": role, "input": inp},
                                     CONFIG.TRIAL_TIMEOUT)
                except AgentBusy:
                    raise
                except AgentError as err:
                    # Stop early only if the agent cannot be reached at all; any other error counts against that item.
                    down = str(err) in ("timeout", "unreachable") or str(err).startswith(("HTTP 404", "HTTP 410", "HTTP 30"))
                    return None, time.monotonic() - t, str(err), down
                good = SHAPES[role](out)
                return (out if good else None), time.monotonic() - t, None if good else "wrong reply shape", False
            try:
                report = await bench.run(role, day.isoformat(), call)
            except AgentBusy as err:
                entry.update(result="busy", reason=f"{BUSY}: {err}")
                metrics.SCREENED.labels(role, "busy", "trial").inc()
                return None
            if not agent["asset"].startswith("unregistered"):
                report["id"] = await store.save_benchmark(agent["asset"], agent["name"], role, bench.VERSION, day, report)
                self.benchmarked.append((agent, role, report))
        entry["bench"] = {"id": report.get("id"), "score": report["score"], "aspects": report["aspects"], "cached": cached, "version": bench.VERSION}
        if report["score"] < CONFIG.BENCH_MIN_SCORE:
            weak = ", ".join(f"{a} {v:.0f}" for a, v in report["aspects"].items() if v < CONFIG.BENCH_MIN_SCORE)
            return reject("trial", f"benchmark {report['score']:.0f}/100, under {CONFIG.BENCH_MIN_SCORE} (weak: {weak})")
        entry.update(stage="hired", result="passed")
        metrics.SCREENED.labels(role, "passed", "hired").inc()
        return {"agent": agent, "score": report["score"], "secs": time.monotonic() - started}

    async def hire(self, role: str) -> list[dict]:
        candidates = await discover(role)
        self.log(f"{role}: {len(candidates)} candidates ({sum(not c['ours'] for c in candidates)} third-party)")

        async def screened(c):
            try:
                return await self.screen(c, role)
            finally:
                await self.save()

        passed = [p for p in await asyncio.gather(*(screened(c) for c in candidates)) if p]
        passed.sort(key=lambda p: (-p["score"], p["secs"]))  # best benchmark score first, then the faster one
        return [p["agent"] for p in passed]

    # ---------- calls ----------
    async def call(self, role: str, inp: dict, task_id: str, exclude: str | None = None):
        """Calls the first live agent for the role. A hard failure (or a breaker trip) marks it dead and raises
        AgentDown, which sends the graph to the replace step."""
        while True:
            agent = next((a for a in self.team[role] if a["asset"] not in self.dead and a["asset"] != exclude), None)
            if not agent:
                raise RuntimeError(f"no working {role} left")
            s = self.touch(agent, role)
            started = time.monotonic()
            call = {"role": role, "agent": agent["name"], "task_id": task_id, "at_ms": self.ms(started), "ms": None, "ok": False}
            self.r["calls"].append(call)
            try:
                out = await post(agent["endpoint"], {"run_id": self.r["run_id"], "task_id": task_id, "role": role, "input": inp}, CONFIG.TASK_TIMEOUT)
                if not SHAPES[role](out):
                    raise AgentError("wrong reply shape", False)
            except AgentBusy as err:
                call.update(ms=int((time.monotonic() - started) * 1000), error="busy")
                metrics.CALLS.labels(role, "busy").inc()
                raise RuntimeError(f"{BUSY} during the {role} step ({err}); the run stopped and no agent was scored for it") from None
            except AgentError as err:
                call.update(ms=int((time.monotonic() - started) * 1000), error=str(err))
                s["fail"] += 1
                s["streak"] += 1
                metrics.CALLS.labels(role, "fail").inc()
                if err.hard or s["streak"] >= CONFIG.BREAKER_FAILS:
                    self.dead.add(agent["asset"])
                    self.r["dead"] = list(self.dead)
                    s["outcome"] = "timeout" if str(err) == "timeout" else "dead"
                    failed = time.monotonic()
                    self.pending_failover = self.pending_failover or {
                        "role": role, "from": agent["asset"], "from_name": agent["name"], "task_id": task_id,
                        "reason": str(err), "since": failed, "failed_at_ms": self.ms(failed),
                        "fail_ms": int((failed - started) * 1000)}  # how long the dead agent's call took to fail
                    self.log(f"  {agent['name']} failed ({err}), marked dead")
                    await self.save()
                    raise AgentDown(role) from None
                continue
            done = time.monotonic()
            call.update(ms=int((done - started) * 1000), ok=True)
            s["ok"] += 1
            s["streak"] = 0
            metrics.CALLS.labels(role, "ok").inc()
            if self.pending_failover and self.pending_failover["role"] == role:
                f = self.pending_failover
                took = int((done - f["since"]) * 1000)
                self.r["failovers"].append({k: v for k, v in f.items() if k != "since"} | {
                    "to": agent["asset"], "to_name": agent["name"], "took_ms": took,
                    "switch_ms": int((started - f["since"]) * 1000),  # from the failure to the backup being called
                    "backup_ms": int((done - started) * 1000),        # the backup's own round trip for the task
                    "recovered_at_ms": self.ms(done)})
                metrics.FAILOVERS.labels(role).inc()
                self.log(f"  {agent['name']} took over {f['task_id']} after {took} ms")
                self.pending_failover = None
            return agent, out

    # ---------- graph steps ----------
    async def step_hire(self):
        self.r["registry"], teams = await asyncio.gather(
            registry_stats(), asyncio.gather(*(self.hire(role) for role in ROLES)), return_exceptions=False)
        for role, team in zip(ROLES, teams):
            self.team[role] = team
            self.r["team"][role] = [{"asset": a["asset"], "name": a["name"]} for a in team]
            if team:
                self.log(f"{role}: hired {team[0]['name']}, backups: {', '.join(a['name'] for a in team[1:]) or 'none'}")
        await self.save()
        missing = [role for role in ROLES if not self.team[role]]
        busy = [role for role in missing if any(h["role"] == role and h["result"] == "busy" for h in self.r["hiring"])]
        if busy:
            raise RuntimeError(f"{BUSY} while testing the {busy[0]} candidates; no agent was scored for it")
        if missing:
            raise RuntimeError(f"no trustworthy {missing[0]} found")

    async def step_plan(self):
        if self.r["plan"]:
            return
        agent, out = await self.call("planner", {"question": self.r["question"], "reasoning": self.r["reasoning"]}, "p1")
        plan = out["subquestions"][:REASONING[self.r["reasoning"]]["subquestions"]]
        self.r["plan"] = [p["question"] for p in plan]
        self.r["tasks"] = [{"id": f"t{i + 1}", "question": p["question"], "search": p.get("search") or p["question"], "web": p.get("web") or p["question"],
                            "planned_by": agent["asset"], "planned_by_name": agent["name"]} for i, p in enumerate(plan)]
        self.log("plan: " + " | ".join(f"{t['question']} [wiki: {t['search']} | web: {t['web']}]" for t in self.r["tasks"]))
        await self.save()

    async def step_retrieve(self):
        if self.kill and not self.killed:  # demo: take the main retriever offline mid-run, so a backup has to take over
            self.killed = self.team["retriever"][0].get("id")  # the URL id the agent server checks
            await store.redis.sadd("agents:killed", self.killed)
            self.r["kill"] = {"agent": self.team["retriever"][0]["name"], "at_ms": self.ms()}
            self.log(f"  [demo] killed {self.team['retriever'][0]['name']}")
        for t in self.r["tasks"]:
            if "sources" in t:
                continue
            agent, out = await self.call("retriever", {"sub_question": t["question"], "search": t["search"], "web": t.get("web"), "question": self.r["question"]}, t["id"])
            t.update(sources=out["sources"][:6], retrieved_by=agent["asset"], retrieved_by_name=agent["name"])
            await self.save()

    async def step_read(self):
        for t in self.r["tasks"]:
            if "facts" in t:
                continue
            agent, out = await self.call("reader", {"sub_question": t["question"], "search": t["search"], "web": t.get("web"), "sources": t["sources"]}, f"{t['id']}-read")
            t.update(facts=out["facts"], read_by=agent["asset"], read_by_name=agent["name"])
            await self.save()

    async def step_reason(self):
        for t in self.r["tasks"]:
            if t.get("reasoned_by"):
                continue
            agent, out = await self.call("reasoner", {"sub_question": t["question"], "question": self.r["question"], "facts": t["facts"], "reasoning": self.r["reasoning"]}, f"{t['id']}-reason")
            t.update(reasoned_by=agent["asset"], reasoned_by_name=agent["name"])
            for c in out["claims"]:
                self.r["claims"].append({
                    "id": f"c{len(self.r['claims']) + 1}", "sub_question": t["question"], "text": c["text"], "source_url": c["source_url"], "quote": c["quote"],
                    "retrieved_by": t["retrieved_by"], "retrieved_by_name": t["retrieved_by_name"],
                    "read_by": t["read_by"], "read_by_name": t["read_by_name"],
                    "produced_by": agent["asset"], "produced_by_name": agent["name"], "status": "pending"})
                self.touch(agent, "reasoner")["claims"] += 1
            await self.save()

    async def step_verify(self):
        """Three checks at a time: each is a small call, so this stays inside the LLM provider's rate limit."""
        while pending := [c for c in self.r["claims"] if c["status"] == "pending"]:
            batch = pending[:3]
            results = await asyncio.gather(*(self.call("verifier", {"claim": c["text"], "source_url": c["source_url"], "quote": c["quote"]},
                                                       f"v-{c['id']}", exclude=c["produced_by"]) for c in batch), return_exceptions=True)
            for c, res in zip(batch, results):
                if isinstance(res, BaseException):
                    continue
                agent, out = res
                c.update(status=out["verdict"], reason=out.get("reason"), verified_by=agent["asset"], verified_by_name=agent["name"])
                metrics.CLAIMS.labels(out["verdict"]).inc()
                if out["verdict"] != "supported":
                    self.stats[(c["produced_by"], "reasoner")]["unsupported"] += 1
            await self.save()
            failed = next((res for res in results if isinstance(res, BaseException)), None)
            if failed:
                raise failed

    async def step_generate(self):
        verified = [c for c in self.r["claims"] if c["status"] == "supported"]
        if not verified:
            self.r["answer"] = ("None of the claims the hired agents found could be verified against their sources, so no answer was written."
                                if self.r["claims"] else f"The hired agents found nothing on Wikipedia{' or the web' if CONFIG.WEB else ''} that answers this question, so no answer was written.")
            return
        allowed = {c["id"] for c in verified}
        for attempt in (1, 2):
            agent, out = await self.call("generator", {"question": self.r["question"], "claims": [{"id": c["id"], "text": c["text"]} for c in verified],
                                                       "length": self.r["length"], "reasoning": self.r["reasoning"]}, f"g{attempt}")
            out["answer"] = split_citations(out["answer"])
            cited = cited_ids(out["answer"])
            if cited and all(x in allowed for x in cited):
                self.r.update(answer=out["answer"], written_by=agent["asset"], written_by_name=agent["name"])
                return
            s = self.touch(agent, "generator")
            s["outcome"] = "bad-citations"
            s["fail"] += 1
        self.r["answer"] = "The generator did not cite verified claims correctly; no answer was accepted."

    async def step_record(self):
        if self.killed:
            await store.redis.srem("agents:killed", self.killed)
        items = []
        for (asset, role), s in self.stats.items():
            total = s["ok"] + s["fail"]
            score = s["ok"] / total if total else 0
            if s["claims"]:
                score *= (s["claims"] - s["unsupported"]) / s["claims"]
            score = round(score * 100)
            outcome = "unsupported-claims" if s["unsupported"] and s["outcome"] == "passed" else s["outcome"]
            item = {"asset": asset, "name": s["name"], "role": role, "ours": s["ours"], "registry": s["registry"], "score": score, "outcome": outcome}
            if asset.startswith("unregistered"):
                item["error"] = "not registered on-chain"
            elif s["registry"] == "sati" and not CONFIG.SATI_FEEDBACK:
                item["error"] = "SATI feedback is off (set SATI_FEEDBACK=on)"
            items.append((item, s))
        self.r["feedback"] = [item for item, _ in items]

        # One Solana transaction per agent. On the public devnet RPC, sending them concurrently triggered its rate limit
        # (2 at a time: 25 s for 7 writes; 4: some failed) versus about 18 s one after another, so the default is 1.
        # With a private RPC, raise FEEDBACK_CONCURRENCY. Writes for the same agent always stay in order.
        gate = asyncio.Semaphore(CONFIG.FEEDBACK_CONCURRENCY)
        per_asset: dict[str, asyncio.Lock] = {}

        async def write(item, s):
            async with gate, per_asset.setdefault(item["asset"], asyncio.Lock()):
                try:
                    item["tx"] = await give_feedback(item["asset"], score=item["score"], role=item["role"], outcome=item["outcome"],
                                                     endpoint=s["endpoint"], report_url=s.get("report_url", self.report_url), registry=s["registry"])
                    metrics.FEEDBACK.labels(s["registry"], "ok").inc()
                    self.log(f"feedback {s['name']}: {item['score']} ({item['outcome']})")
                except Exception as err:  # noqa: BLE001
                    item["error"] = str(err) or type(err).__name__  # a timeout's message is empty
                    metrics.FEEDBACK.labels(s["registry"], "fail").inc()
                    self.log(f"feedback {s['name']} failed: {err}")

        # Fresh benchmark results are published too: tag1 = role, tag2 = benchmark version, linked to the full report.
        for agent, role, report in self.benchmarked:
            item = {"asset": agent["asset"], "name": agent["name"], "role": role, "ours": agent["ours"], "registry": agent.get("registry", "8004"),
                    "score": round(report["score"]), "outcome": bench.VERSION, "benchmark_id": report["id"]}
            if item["registry"] == "sati" and not CONFIG.SATI_FEEDBACK:
                item["error"] = "SATI feedback is off (set SATI_FEEDBACK=on)"
            self.r["feedback"].append(item)
            items.append((item, {"name": agent["name"], "endpoint": agent["endpoint"], "registry": item["registry"],
                                 "report_url": f"{CONFIG.AGENTS_BASE_URL}/api/benchmarks/{report['id']}"}))

        if self.feedback:
            await asyncio.gather(*(write(item, s) for item, s in items if "error" not in item))
            for item, _ in items:
                if item.get("benchmark_id") and item.get("tx"):
                    await store.set_benchmark_tx(item["benchmark_id"], item["tx"])

        r = self.r
        bad = [h for h in r["hiring"] if h["ours"] and h.get("id", "").startswith("bad-")]
        third = [h for h in r["hiring"] if not h["ours"]]
        r["metrics"] = {
            "claims": len(r["claims"]),
            "claims_tagged_pct": round(100 * sum(1 for c in r["claims"] if c.get("produced_by") and c.get("source_url") and c.get("verified_by")) / len(r["claims"])) if r["claims"] else 0,
            "claims_supported": sum(1 for c in r["claims"] if c["status"] == "supported"),
            "bad_agents_rejected": f"{sum(1 for h in bad if h['result'] == 'failed')}/{len(bad)}",
            "third_party_tried": len(third),
            "third_party_passed": sum(1 for h in third if h["result"] == "passed"),
            "failovers": len(r["failovers"]),
            "failover_ms": max((f["took_ms"] for f in r["failovers"]), default=None),
            "feedback_written": f"{sum(1 for f in r['feedback'] if f.get('tx'))}/{len(r['feedback'])}",
        }
        r["finished_at"] = now()
        r["round_trip_ms"] = self.ms()
        r["timings"]["record"] = int((time.monotonic() - getattr(self, "record_started", time.monotonic())) * 1000)
        await self.save()
        await store.save_records(r)

    # ---------- the graph ----------
    def graph(self):
        g = StateGraph(State)
        work = [("hire", self.step_hire), ("plan", self.step_plan), ("retrieve", self.step_retrieve), ("read", self.step_read),
                ("reason", self.step_reason), ("verify", self.step_verify), ("generate", self.step_generate)]

        def node(name, fn):
            async def run_step(state: State) -> State:
                started = time.monotonic()
                try:
                    await fn()
                    return {"failure": None, "resume": None}
                except AgentDown as down:
                    return {"failure": down.role, "resume": name}
                except Exception as err:  # noqa: BLE001 - anything that stops the run still falls through to feedback
                    return {"error": str(err)}
                finally:  # a step re-entered after a replacement adds to its time
                    self.r["timings"][name] = self.r["timings"].get(name, 0) + int((time.monotonic() - started) * 1000)
            return run_step

        for i, (name, fn) in enumerate(work):
            nxt = work[i + 1][0] if i + 1 < len(work) else "record"
            g.add_node(name, node(name, fn))
            g.add_conditional_edges(name, lambda s, nxt=nxt: "record" if s.get("error") else "replace" if s.get("failure") else nxt,
                                    [nxt, "replace", "record"] if nxt != "record" else ["replace", "record"])

        async def replace(state: State) -> State:
            role = state["failure"]
            if not any(a["asset"] not in self.dead for a in self.team[role]):
                return {"error": f"no working {role} left"}
            return {}

        g.add_node("replace", replace)
        g.add_conditional_edges("replace", lambda s: "record" if s.get("error") else s["resume"], [n for n, _ in work] + ["record"])

        async def record(state: State) -> State:
            self.record_started = time.monotonic()
            if state.get("error"):
                self.r["error"] = state["error"]
                self.r["answer"] = f"Run stopped: {state['error']}."
                self.log(f"run stopped: {state['error']}")
            await self.step_record()
            return {}

        g.add_node("record", record)
        g.add_edge(START, "hire")
        g.add_edge("record", END)
        return g.compile()

    async def run(self) -> dict:
        started = time.monotonic()
        llm.USED.clear()
        await self.save()  # the page shows the question at once
        await self.graph().ainvoke({}, {"recursion_limit": 80})
        if CONFIG.LLM and llm.USED:
            self.r["mode"] = f"{CONFIG.PROVIDER} · {', '.join(sorted(llm.USED))}"
            await self.save()
        metrics.RUNS.labels("stopped" if self.r.get("error") else "answered").inc()
        metrics.RUN_SECONDS.observe(time.monotonic() - started)
        return self.r


async def run(question: str, **kw) -> dict:
    return await Run(question, **kw).run()


async def _main():
    args = sys.argv[1:]
    question = " ".join(a for a in args if not a.startswith("--"))
    if not question:
        sys.exit('usage: python -m app.orchestrator "your question" [--kill] [--no-feedback]')
    await store.connect()
    await seed_cache()
    try:
        r = await run(question, feedback="--no-feedback" not in args, kill="--kill" in args)
        print(f"\n{r['answer']}\n")
        for k, v in r["metrics"].items():
            print(f"  {k}: {v}")
        print(f"report: {CONFIG.AGENTS_BASE_URL}/api/runs/{r['run_id']}")
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(_main())
