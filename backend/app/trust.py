"""Fake-reputation detector for the Solana Agent Registry (8004).

Anyone can rate any agent, so a high score on the registry says little by itself. Sworn reads every rating on the
registry (through the indexer), flags the ones that do not look like independent customers, and scores each agent on
what is left. Simple rules anyone can check, no AI:

  self           the rater owns the agent
  captive        the wallet has rated 3+ times, always one owner's agents (the usual way to self-rate: a second wallet)
  burst          under 10 s after the same wallet rated that owner's agents: a script, not a customer
  single_source  all of the agent's 3+ ratings come from one wallet
  ring           two operators rate each other's agents (a wallet's operator is itself if it owns agents, or the one
                 owner it is captive to)

A flag only removes a rating from the independent score; every flag is shown with its evidence, never as a verdict
on the agent. Ratings are kept in Postgres and refreshed from the indexer in the background (app/main.py).
"""
import asyncio
import json
import time
from collections import Counter, defaultdict

from . import store
from .registry import indexer, list_agents

FLAGS = ["self", "captive", "burst", "single_source", "ring"]
CAPTIVE_MIN = 3       # ratings before a one-owner wallet counts as captive
SINGLE_MIN = 3        # ratings before "all from one wallet" means anything
BURST_SECONDS = 10
GRAPH_EDGES = 140     # the busiest rater -> owner links drawn on the page (all of them would be unreadable)
PAGE_GAP = 2.0        # seconds between indexer pages: it allows 60 requests a minute, shared with discovery

# Paged by time, newest first: the indexer ignores skip past 5,000 and keeps returning the same page.
QUERY = """query($before: BigInt) { feedbacks(first: 250, orderBy: createdAt, orderDirection: desc, where: {createdAt_lt: $before}) {
  id clientAddress value createdAt isRevoked agent { id owner } solana { score } } }"""

_state: dict | None = None  # {"flags": {rating id: [flag]}, "by_agent": {asset: [rating]}, "report": {...}}


def _score(f: dict):
    s = (f.get("solana") or {}).get("score")
    s = float(f["value"]) if s is None and f.get("value") is not None else s
    return float(s) if s is not None and 0 <= float(s) <= 100 else None  # a few raters write raw values: not a 0-100 score


async def collect() -> int:
    """Newest ratings first, a page at a time, each page older than the last. Once one full read has finished,
    it stops at the first page holding a rating we already have. Returns how many were new.
    ponytail: a rating revoked after we stored it stays unrevoked here; a periodic full re-read would catch it."""
    known = {r["id"] for r in await store.registry_ratings()}
    complete = bool(await store.redis.get("trust:complete"))
    new, before, seen = 0, str(int(time.time()) + 3600), set()
    while True:
        page = [f for f in (await indexer(QUERY, {"before": before}))["feedbacks"] if f.get("agent")]
        rows = [{"id": f["id"], "agent": f["agent"]["id"], "owner": f["agent"]["owner"], "client": f["clientAddress"],
                 "score": _score(f), "at": int(f["createdAt"]), "revoked": bool(f["isRevoked"])} for f in page if f["id"] not in seen]
        if rows:
            await store.save_registry_ratings(rows)
        new += sum(r["id"] not in known for r in rows)
        seen.update(r["id"] for r in rows)
        if len(page) < 250:
            await store.redis.set("trust:complete", "1")
            return new
        if complete and any(r["id"] in known for r in rows):
            return new
        # The next page includes this page's oldest second, so ratings sharing it are not skipped (seen dedupes);
        # if that brought nothing new, step strictly older.
        oldest = min(int(f["createdAt"]) for f in page)
        before = str(oldest + 1) if rows and str(oldest + 1) != before else str(oldest)
        await asyncio.sleep(PAGE_GAP)


def analyze(rows: list[dict]) -> tuple[dict[str, list[str]], dict]:
    """Flags for every rating, and the report: summary, per-agent scores and the graph."""
    rows = [r for r in rows if not r["revoked"]]
    by_client, by_agent = defaultdict(list), defaultdict(list)
    for r in rows:
        by_client[r["client"]].append(r)
        by_agent[r["agent"]].append(r)
    owners = {r["owner"] for r in rows}
    owners_rated = {c: {r["owner"] for r in rs} for c, rs in by_client.items()}
    captive = {c for c, rs in by_client.items() if len(rs) >= CAPTIVE_MIN and len(owners_rated[c]) == 1}

    def operator(c):
        return c if c in owners else next(iter(owners_rated[c])) if c in captive else None

    rates = {(operator(r["client"]), r["owner"]) for r in rows if operator(r["client"])}  # operator -> owner it rates
    single = {a for a, rs in by_agent.items() if len(rs) >= SINGLE_MIN and len({r["client"] for r in rs}) == 1}

    flags: dict[str, list[str]] = {}
    for c, rs in by_client.items():
        last: dict[str, int] = {}  # owner -> when this wallet last rated one of that owner's agents
        op = operator(c)
        for r in sorted(rs, key=lambda r: r["at"]):
            f = []
            if c == r["owner"]:
                f.append("self")
            if c in captive:
                f.append("captive")
            if r["owner"] in last and r["at"] - last[r["owner"]] < BURST_SECONDS:
                f.append("burst")
            last[r["owner"]] = r["at"]
            if r["agent"] in single:
                f.append("single_source")
            if op and op != r["owner"] and (r["owner"], op) in rates:
                f.append("ring")
            flags[r["id"]] = f

    agents = []
    for a, rs in by_agent.items():
        scored = [r for r in rs if r["score"] is not None]
        clean = [r for r in scored if not flags[r["id"]]]
        raw = round(sum(r["score"] for r in scored) / len(scored), 1) if scored else None
        independent = round(sum(r["score"] for r in clean) / len(clean), 1) if clean else None
        verdict = "no_independent" if not clean else "independent" if len(clean) * 2 >= len(rs) else "mostly_flagged"
        agents.append({"asset": a, "owner": rs[0]["owner"], "ratings": len(rs), "raters": len({r["client"] for r in rs}),
                       "raw": raw, "independent": independent, "independent_count": len(clean),
                       "independent_pct": round(100 * sum(not flags[r["id"]] for r in rs) / len(rs)),
                       "flags": dict(Counter(f for r in rs for f in flags[r["id"]])), "verdict": verdict})
    agents.sort(key=lambda x: -x["ratings"])

    flagged = sum(bool(f) for f in flags.values())
    summary = {
        "ratings": len(rows), "agents": len(by_agent), "raters": len(by_client), "owners": len(owners),
        "flagged": flagged, "flagged_pct": round(100 * flagged / len(rows), 1) if rows else 0,
        "by_flag": {k: sum(k in f for f in flags.values()) for k in FLAGS},
        "captive_wallets": len(captive), "captive_ratings_pct": round(100 * sum(len(by_client[c]) for c in captive) / len(rows), 1) if rows else 0,
        "verdicts": dict(Counter(x["verdict"] for x in agents)),
        "agents_3plus": sum(x["ratings"] >= 3 for x in agents),
    }

    # The graph: rater wallets -> the owners whose agents they rate, busiest links first. A link is red when most
    # of its ratings are flagged, with the most common reason.
    links = defaultdict(list)
    for r in rows:
        links[(r["client"], r["owner"])].append(flags[r["id"]])
    edges = []
    for (c, o), fs in sorted(links.items(), key=lambda kv: -len(kv[1]))[:GRAPH_EDGES]:
        why = Counter(f for x in fs for f in x).most_common(1)
        edges.append({"source": c, "target": o, "n": len(fs), "flagged": sum(bool(x) for x in fs) * 2 > len(fs), "why": why[0][0] if why else None})
    ids = {e["source"] for e in edges} | {e["target"] for e in edges}
    agent_count = Counter(r["owner"] for r in agents)
    nodes = [{"id": w, "owner": w in owners, "rates": w in by_client, "agents": agent_count.get(w, 0),
              "captive": w in captive, "ratings_given": len(by_client.get(w, []))} for w in ids]
    return flags, {"summary": summary, "agents": agents, "graph": {"nodes": nodes, "edges": edges}}


async def load():
    """Re-analyse everything stored. Fast (a fraction of a second for tens of thousands of ratings)."""
    global _state
    rows = await store.registry_ratings()
    if not rows:
        return
    flags, report = analyze(rows)
    try:
        names = {a["id"]: (a.get("registrationFile") or {}).get("name") for a in await list_agents()}
    except Exception:  # noqa: BLE001 - names are a nicety; the indexer may be busy
        names = {}
    for a in report["agents"]:
        a["name"] = names.get(a["asset"])
    report["summary"]["updated_at"] = max(r["at"] for r in rows)
    report["summary"]["analysed_at"] = int(time.time())
    by_agent = defaultdict(list)
    for r in rows:
        if not r["revoked"]:
            by_agent[r["agent"]].append(r)
    _state = {"flags": flags, "by_agent": by_agent, "report": report}
    await store.redis.set("trust:report", json.dumps(report))


async def refresh() -> int:
    new = await collect()
    await load()
    return new


def ready() -> bool:
    return _state is not None


def agent_score(asset: str, exclude: set[str] = frozenset()) -> dict | None:
    """Same shape as registry.get_score: {average, count, self_count} over independent ratings only, plus why the
    others were left out. exclude: wallets known to belong to the agent's own operator (ours, for our agents)."""
    rs = _state["by_agent"].get(asset, [])
    why = Counter()
    clean = []
    for r in rs:
        f = _state["flags"].get(r["id"], [])
        if r["client"] in exclude:
            why["operator"] += 1
        elif f:
            why[f[0]] += 1
        elif r["score"] is not None:
            clean.append(r["score"])
    ignored = sum(why.values())
    if not clean:
        return {"average": None, "count": 0, "self_count": ignored, "ignored": dict(why)} if ignored else None
    return {"average": round(sum(clean) / len(clean), 1), "count": len(clean), "self_count": ignored, "ignored": dict(why)}
