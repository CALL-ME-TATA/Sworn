"""Sworn Agent Benchmark (SAB): one test, the same for every agent in a role, ours or anyone else's.

Five aspects, each scored 0 to 100 by code (never by an LLM), weighted equally; an aspect that does not apply to a
role is left out and the others share its weight equally. Items come from public datasets (see bench_build.py and
docs/BENCHMARK.md). Each hiring round draws one sample per role and gives the same sample to every candidate.

  accuracy     the right answer on known-answer items          SQuAD/HotpotQA answer match, recall@k, FEVER labels
  grounding    nothing invented: quotes and citations are real  verbatim quotes, citation precision and coverage
  honesty      says "not found" / "unsupported" when it should  SQuAD 2.0 unanswerable questions, FEVER refutations
  reliability  calls succeed and come back in the right shape   success rate
  speed        95th-percentile response time within budget      p95 latency against a per-role target
"""
import json
import random
import re
import time
from functools import lru_cache

from .config import DATA
from .sources import normalize, quote_in, source_text, wiki_url

VERSION = "sab-v1"
ASPECTS = ["accuracy", "grounding", "honesty", "reliability", "speed"]
# p95 target per role in seconds: full marks at or under it, falling to zero at three times it.
LATENCY_BUDGET = {"planner": 6, "retriever": 4, "reader": 4, "reasoner": 10, "verifier": 6, "generator": 12}
PER_KIND = 2  # items per kind of check in one hiring round: enough to tell good from bad, cheap on free tiers

NOT_FOUND = re.compile(r"\b(do(es)? not (say|mention|state|specify|contain|provide|include|give)|not (found|available|mentioned|stated)|"
                       r"no (information|mention)|cannot be determined|(is|are) unknown|don't|doesn't)\b", re.I)


@lru_cache(maxsize=1)
def bank() -> dict:
    return json.loads((DATA / "bench" / f"{VERSION}.json").read_text(encoding="utf-8"))


def _title_hit(gold: str, text: str) -> bool:
    """A gold article counts as found if every content word of its title (ignoring a bracketed qualifier) appears."""
    words = re.findall(r"[a-z0-9]+", normalize(re.sub(r"\s*\(.*?\)", "", gold)))
    t = normalize(text)
    return bool(words) and all(w in t for w in words)


def _answer_hit(answers: list[str], text: str) -> bool:
    """SQuAD-style match: the normalised gold answer appears in the agent's text."""
    t = normalize(re.sub(r"[^\w\s]", " ", text))
    return any(normalize(re.sub(r"[^\w\s]", " ", a)) in t for a in answers)


def sample(role: str, seed: str) -> list[dict]:
    """The checks one hiring round gives every candidate for this role. Each check: kind, aspect, input, grade."""
    rng = random.Random(f"{VERSION}-{role}-{seed}")
    items = bank()["items"]
    pick = lambda kind: rng.sample(items[kind], min(PER_KIND, len(items[kind])))  # noqa: E731
    checks = []

    if role == "planner":
        for it in pick("hotpot"):
            checks.append({"aspect": "accuracy", "item": it["id"], "input": {"question": it["question"]},
                           "grade": lambda o, it=it: _plan_recall(it, o)})
    elif role == "retriever":
        for it in pick("hotpot"):
            checks.append({"aspect": "accuracy", "item": it["id"], "input": {"sub_question": it["question"], "question": it["question"]},
                           "grade": lambda o, it=it: _recall_at_k(it, o)})
            checks.append({"aspect": "grounding", "item": it["id"], "same_call": True, "grade": _sources_real})
    elif role == "reader":
        for it in pick("squad_answerable"):
            inp = {"sub_question": it["question"], "sources": [{"title": it["title"], "url": it["source_url"]}]}
            checks.append({"aspect": "accuracy", "item": it["id"], "input": inp,
                           "grade": lambda o, it=it: float(_answer_hit(it["answers"], " ".join(f.get("quote", "") for f in o.get("facts", []))))})
            checks.append({"aspect": "grounding", "item": it["id"], "same_call": True, "grade": lambda o: _quotes_real(o.get("facts", []))})
    elif role == "reasoner":
        for it in pick("squad_answerable"):
            inp = {"sub_question": it["question"], "question": it["question"], "facts": it["facts"]}
            checks.append({"aspect": "accuracy", "item": it["id"], "input": inp,
                           "grade": lambda o, it=it: float(_answer_hit(it["answers"], " ".join(c.get("text", "") for c in o.get("claims", []))))})
            checks.append({"aspect": "grounding", "item": it["id"], "same_call": True,
                           "grade": lambda o, it=it: _quotes_from(o.get("claims", []), it["facts"])})
        for it in pick("squad_unanswerable"):
            inp = {"sub_question": it["question"], "question": it["question"], "facts": it["facts"]}
            checks.append({"aspect": "honesty", "item": it["id"], "input": inp, "grade": lambda o: float(not o.get("claims"))})
    elif role == "verifier":
        for kind, aspect, expect in (("fever_supports", "accuracy", "supported"), ("fever_refutes", "honesty", "unsupported"),
                                     ("fever_tampered", "grounding", "unsupported")):
            for it in pick(kind):
                checks.append({"aspect": aspect, "item": it["id"], "input": {"claim": it["claim"], "quote": it["quote"], "source_url": it["source_url"]},
                               "grade": lambda o, expect=expect: float(o.get("verdict") == expect)})
    elif role == "generator":
        for it in pick("hotpot"):
            claims = [{"id": f"c{i + 1}", "text": s} for i, s in enumerate(it["support"] + it["distractors"])]
            checks.append({"aspect": "accuracy", "item": it["id"], "input": {"question": it["question"], "claims": claims},
                           "grade": lambda o, it=it: float(_answer_hit([it["answer"]], o.get("answer", "")))})
            checks.append({"aspect": "grounding", "item": it["id"], "same_call": True,
                           "grade": lambda o, claims=claims: _citations(o.get("answer", ""), {c["id"] for c in claims})})
        for it in pick("hotpot"):
            claims = [{"id": f"c{i + 1}", "text": s} for i, s in enumerate(it["distractors"])]  # the answer is not in these
            checks.append({"aspect": "honesty", "item": it["id"] + "-no-answer", "input": {"question": it["question"], "claims": claims},
                           "grade": lambda o, it=it: float(not _answer_hit([it["answer"]], o.get("answer", "")) and bool(NOT_FOUND.search(o.get("answer", ""))))})
    return checks


def _plan_recall(it, out) -> float:
    text = " ".join(f"{s.get('question', '')} {s.get('search', '')} {s.get('web', '')}" for s in out.get("subquestions", []) if isinstance(s, dict))
    return sum(_title_hit(t, text) for t in it["gold_titles"]) / len(it["gold_titles"])


def _recall_at_k(it, out) -> float:
    titles = " | ".join(s.get("title", "") for s in out.get("sources", []) if isinstance(s, dict))
    return sum(_title_hit(t, titles) for t in it["gold_titles"]) / len(it["gold_titles"])


async def _sources_real(out) -> float:
    sources = [s for s in out.get("sources", []) if isinstance(s, dict) and s.get("url")][:6]
    if not sources:
        return 0.0
    ok = 0
    for s in sources:
        try:
            ok += bool((await source_text(s["url"])).strip())
        except Exception:  # noqa: BLE001
            pass
    return ok / len(sources)


async def _quotes_real(facts) -> float:
    facts = [f for f in facts if isinstance(f, dict)]
    if not facts:
        return 0.0
    ok = 0
    for f in facts:
        try:
            ok += quote_in(await source_text(f.get("source_url", "")), f.get("quote"))
        except Exception:  # noqa: BLE001
            pass
    return ok / len(facts)


def _quotes_from(claims, facts) -> float:
    """Every claim's quote must be one of the sentences it was given, word for word."""
    claims = [c for c in claims if isinstance(c, dict)]
    if not claims:
        return 1.0  # nothing stated, nothing invented
    given = {normalize(f["quote"]) for f in facts}
    return sum(normalize(c.get("quote", "")) in given for c in claims) / len(claims)


def _citations(answer: str, allowed: set[str]) -> float:
    """ALCE-style: citation precision (only known claim IDs) times coverage (sentences that carry a citation)."""
    cited = re.findall(r"\[(c\d+)\]", answer)
    if not cited:
        return 0.0
    precision = sum(c in allowed for c in cited) / len(cited)
    # A sentence, with the citations that directly follow it ("... in 1928. [c1][c2]").
    sentences = [s for s in re.findall(r"[^.!?\n]+[.!?]+(?:\s*\[c\d+\])*", answer) if len(re.sub(r"\[c\d+\]", "", s).strip()) > 20]
    coverage = sum(bool(re.search(r"\[c\d+\]", s)) for s in sentences) / max(1, len(sentences))
    return precision * coverage


def speed_score(role: str, seconds: list[float]) -> float:
    if not seconds:
        return 0.0
    s = sorted(seconds)
    p95 = s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]
    budget = LATENCY_BUDGET[role]
    return 100.0 if p95 <= budget else max(0.0, 100.0 * (3 * budget - p95) / (2 * budget))


def combine(role: str, per_aspect: dict[str, list[float]], calls_ok: int, calls: int, seconds: list[float]) -> dict:
    """Aspect scores 0-100 and the overall score: the plain mean of the aspects that apply (equal weights)."""
    aspects = {a: round(100 * sum(v) / len(v), 1) for a, v in per_aspect.items() if v}
    aspects["reliability"] = round(100 * calls_ok / calls, 1) if calls else 0.0
    aspects["speed"] = round(speed_score(role, seconds), 1)
    applicable = [a for a in ASPECTS if a in aspects]
    return {"aspects": {a: aspects[a] for a in applicable}, "score": round(sum(aspects[a] for a in applicable) / len(applicable), 1),
            "weights": {a: round(1 / len(applicable), 3) for a in applicable}}


async def run(role: str, seed: str, call) -> dict:
    """Runs the round's checks against one agent. call(input) -> (output | None, seconds, error, hard).
    After a hard failure (down, timed out, gone) the remaining checks score 0 without being sent, as they would fail too."""
    checks = sample(role, seed)
    per_aspect: dict[str, list[float]] = {}
    details, seconds, ok, calls = [], [], 0, 0
    last, down = None, None
    for c in checks:
        if c.get("same_call"):
            out = last
        elif down:
            calls += 1
            out = last = None
            details.append({"item": c["item"], "aspect": c["aspect"], "score": 0.0, "error": f"not sent: {down}"})
        else:
            calls += 1
            out, secs, err, hard = await call(c["input"])
            if out is not None:  # speed is measured on answers only: failing fast must not earn speed points
                seconds.append(secs)
            ok += out is not None
            last = out
            if err:
                details.append({"item": c["item"], "aspect": c["aspect"], "score": 0.0, "error": err})
            if hard:
                down = err
        if out is None:
            per_aspect.setdefault(c["aspect"], []).append(0.0)
            continue
        g = c["grade"](out)
        g = float(await g) if hasattr(g, "__await__") else float(g)
        per_aspect.setdefault(c["aspect"], []).append(g)
        details.append({"item": c["item"], "aspect": c["aspect"], "score": round(g, 3)})
    result = combine(role, per_aspect, ok, calls, seconds)
    return {**result, "version": VERSION, "role": role, "seed": seed, "items": details,
            "p95_s": round(sorted(seconds)[int(round(0.95 * (len(seconds) - 1)))], 2) if seconds else None, "at": time.time()}
