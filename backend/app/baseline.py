"""Fixed-team baseline vs our system on the same questions. Usage: python -m app.baseline
Baseline: a hardcoded team; reasoner-a and bad-liar take turns on sub-questions. No screening, no verification.
Both sides are graded the same way: a claim used in the answer counts as supported only if its quote is on its source page."""
import asyncio
import json

from . import store
from .config import CONFIG, DATA, agent_url
from .orchestrator import cited_ids, post, run
from .sources import quote_in, seed_cache, source_text

REASONERS = ["reasoner-a", "bad-liar"]


async def call(name: str, role: str, inp: dict, task_id: str):
    try:
        return await post(agent_url(name), {"task_id": task_id, "role": role, "input": inp}, CONFIG.TASK_TIMEOUT)
    except Exception:  # noqa: BLE001 - the fixed team has no failover; a failed call just loses that part
        return None


async def baseline(question: str) -> list[dict]:
    plan = (await call("planner-a", "planner", {"question": question}, "p1") or {}).get("subquestions", [])
    claims = []
    for i, step in enumerate(plan):
        inp = {"sub_question": step["question"], "search": step.get("search"), "web": step.get("web"), "question": question}
        sources = (await call("retriever-a", "retriever", inp, f"t{i + 1}") or {}).get("sources", [])
        facts = (await call("reader-a", "reader", inp | {"sources": sources}, f"t{i + 1}-read") or {}).get("facts", [])
        out = await call(REASONERS[i % len(REASONERS)], "reasoner", inp | {"facts": facts}, f"t{i + 1}-reason") or {}
        claims += [{"id": f"c{len(claims) + 1}", **c} for c in out.get("claims", [])]
    if not claims:
        return []
    out = await call("generator-a", "generator", {"question": question, "claims": [{"id": c["id"], "text": c["text"]} for c in claims]}, "g1") or {}
    cited = set(cited_ids(out.get("answer", "")))
    return [c for c in claims if c["id"] in cited]


async def is_supported(c: dict) -> bool:
    try:
        return quote_in(await source_text(c["source_url"]), c["quote"])
    except Exception:  # noqa: BLE001
        return False


async def score(used: list[dict]) -> tuple[int, int]:
    ok = sum(await asyncio.gather(*(is_supported(c) for c in used)))
    return len(used), len(used) - ok


async def main():
    await store.connect()
    await seed_cache()
    questions = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))
    rows = []
    for q in questions:
        print(f"\n{q}")
        b_used, b_bad = await score(await baseline(q))
        ours = await run(q, feedback=False, log=lambda *_: None, latest=False)
        used_ids = set(cited_ids(ours["answer"] or ""))
        o_used, o_bad = await score([c for c in ours["claims"] if c["id"] in used_ids])
        rows.append({"question": q, "baseline_used": b_used, "baseline_unsupported": b_bad,
                     "ours_used": o_used, "ours_unsupported": o_bad, "ours_run": ours["run_id"]})
        print(f"  baseline: {b_bad}/{b_used} unsupported   ours: {o_bad}/{o_used} unsupported")
    pct = lambda bad, used: round(100 * bad / used) if used else 0  # noqa: E731
    total = lambda k: sum(r[k] for r in rows)  # noqa: E731
    summary = {"baseline_unsupported_pct": pct(total("baseline_unsupported"), total("baseline_used")),
               "ours_unsupported_pct": pct(total("ours_unsupported"), total("ours_used"))}
    print(summary)
    await store.save_comparison({"rows": rows, "summary": summary, "mode": f"{CONFIG.PROVIDER} · {CONFIG.MODEL}" if CONFIG.LLM else "rule-based"})
    await store.close()


if __name__ == "__main__":
    asyncio.run(main())
