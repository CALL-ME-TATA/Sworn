"""Builds the Sworn Agent Benchmark item bank (data/bench/sab-v1.json) from public datasets.

Items are sampled with a fixed seed from the validation splits of SQuAD 2.0, HotpotQA and FEVER, then re-checked
against today's Wikipedia: an item is kept only if what it relies on is still on the live page (the answer, the
evidence sentence, the article itself). Every item records its dataset, split and row, so the bank is reproducible.
Usage: python -m app.bench_build"""
import asyncio
import json
import random
import re
import urllib.parse
from datetime import datetime, timezone

import httpx

from . import rules, store
from .config import DATA
from .sources import normalize, quote_in, seed_cache, wiki_text, wiki_url

VERSION = "sab-v1"
ROWS = "https://datasets-server.huggingface.co/rows"
SEED = 2026
PER_ROLE = 30  # items kept per role and kind; a hiring round samples from these

SOURCES = {
    "squad_v2": {"dataset": "rajpurkar/squad_v2", "config": "squad_v2", "split": "validation", "license": "CC BY-SA 4.0",
                 "paper": "Rajpurkar, Jia and Liang, Know What You Don't Know: Unanswerable Questions for SQuAD (ACL 2018)"},
    "hotpot_qa": {"dataset": "hotpotqa/hotpot_qa", "config": "distractor", "split": "validation", "license": "CC BY-SA 4.0",
                  "paper": "Yang et al., HotpotQA: A Dataset for Diverse, Explainable Multi-hop Question Answering (EMNLP 2018)"},
    "fever": {"dataset": "copenlu/fever_gold_evidence", "config": "default", "split": "validation", "license": "CC BY-SA 3.0",
              "paper": "Thorne et al., FEVER: a Large-scale Dataset for Fact Extraction and VERification (NAACL 2018)"},
}

_http = httpx.AsyncClient(timeout=60, headers={"User-Agent": "sworn-bench-builder"})


async def sample_rows(source: str, n: int) -> list[tuple[int, dict]]:
    """n rows at seeded random offsets, fetched in pages of 100 from the Hugging Face datasets server."""
    s = SOURCES[source]
    q = urllib.parse.urlencode({"dataset": s["dataset"], "config": s["config"], "split": s["split"], "offset": 0, "length": 1})
    total = (await _http.get(f"{ROWS}?{q}")).json()["num_rows_total"]
    rng = random.Random(f"{SEED}-{source}")
    pages = sorted(rng.sample(range(0, total, 100), max(1, n // 100 + 1)))
    out = []
    for offset in pages:
        q = urllib.parse.urlencode({"dataset": s["dataset"], "config": s["config"], "split": s["split"], "offset": offset, "length": 100})
        for r in (await _http.get(f"{ROWS}?{q}")).json()["rows"]:
            out.append((r["row_idx"], r["row"]))
    rng.shuffle(out)
    return out


def detok(s: str) -> str:
    """FEVER sentences are PTB-tokenised ("film -LRB-2016-RRB- ." ); turn them back into plain text."""
    for a, b in {"-LRB-": "(", "-RRB-": ")", "-LSB-": "[", "-RSB-": "]", "-LCB-": "{", "-RCB-": "}", "-COLON-": ":", "``": '"', "''": '"'}.items():
        s = s.replace(a, b)
    s = re.sub(r"\s+([.,;:!?%)\]}])", r"\1", s)
    s = re.sub(r"([(\[{$])\s+", r"\1", s)
    s = re.sub(r"\s+('s|n't|'re|'ve|'ll|'d|'m)\b", r"\1", s)
    s = re.sub(r'"\s+(.*?)\s+"', r'"\1"', s)
    return re.sub(r"\s+", " ", s).strip()


def ref(source: str, row: int) -> dict:
    s = SOURCES[source]
    return {"dataset": s["dataset"], "split": s["split"], "row": row}


async def page(title: str) -> str:
    try:
        return await wiki_text(title)
    except Exception:  # noqa: BLE001 - the article was renamed or deleted since the dataset was made
        return ""


async def squad_items(n: int):
    """Reader and reasoner: SQuAD 2.0 questions whose answer is still on today's article; unanswerable ones as traps."""
    answerable, unanswerable = [], []
    for row_idx, r in await sample_rows("squad_v2", n * 12):
        if len(answerable) >= n and len(unanswerable) >= n:
            break
        title = r["title"].replace("_", " ")
        text = await page(title)
        if not text:
            continue
        facts = rules.pick_sentences(r["question"], [{"url": wiki_url(title), "text": text[:40000]}], 12)
        item = {"id": f"squad-{r['id']}", "question": r["question"], "title": title, "source_url": wiki_url(title),
                "facts": facts, "ref": ref("squad_v2", row_idx)}
        answers = sorted({a for a in r["answers"]["text"] if a.strip()})
        if answers and len(answerable) < n:
            # Kept only if the answer is still on the page and among the facts every reasoner is given.
            if any(normalize(a) in normalize(text) for a in answers) and any(normalize(a) in normalize(f["quote"]) for f in facts for a in answers):
                answerable.append({**item, "answers": answers})
        elif not answers and len(unanswerable) < n:
            unanswerable.append({**item, "answers": []})
    return answerable, unanswerable


async def hotpot_items(n: int):
    """Planner, retriever and writer: HotpotQA questions whose two gold articles still exist."""
    out = []
    for row_idx, r in await sample_rows("hotpot_qa", n * 4):
        if len(out) >= n:
            break
        answer = r["answer"].strip()
        if answer.lower() in ("yes", "no"):
            continue  # a yes/no answer cannot be checked by matching text in the writer's answer
        gold = list(dict.fromkeys(r["supporting_facts"]["title"]))
        if len(gold) != 2 or not all([await page(t) for t in gold]):
            continue
        titles, sentences = r["context"]["title"], r["context"]["sentences"]
        sf = set(zip(r["supporting_facts"]["title"], r["supporting_facts"]["sent_id"]))
        support = [sentences[i][j].strip() for i, t in enumerate(titles) for j in range(len(sentences[i])) if (t, j) in sf]
        distract = [sentences[i][0].strip() for i, t in enumerate(titles) if t not in gold][:3]
        out.append({"id": f"hotpot-{r['id']}", "question": r["question"], "answer": answer, "gold_titles": gold,
                    "support": support, "distractors": distract, "ref": ref("hotpot_qa", row_idx)})
    return out


async def fever_items(n: int):
    """Verifier: FEVER claims with one evidence sentence that is still word for word on today's article."""
    supports, refutes = [], []
    for row_idx, r in await sample_rows("fever", n * 45):
        if len(supports) >= n and len(refutes) >= n:
            break
        if r["label"] not in ("SUPPORTS", "REFUTES") or len(r["evidence"]) != 1:
            continue
        title = detok(r["evidence"][0][0].replace("_", " "))
        quote = detok(r["evidence"][0][2])
        if len(quote) < 30:
            continue
        text = await page(title)
        if not text or not quote_in(text, quote):
            continue
        item = {"id": f"fever-{r['id']}", "claim": r["claim"], "quote": quote, "source_url": wiki_url(title),
                "label": r["label"], "ref": ref("fever", row_idx)}
        (supports if r["label"] == "SUPPORTS" else refutes).append(item)
    supports, refutes = supports[:n], refutes[:n]
    # Grounding check: the same supported claim, but its quote altered so it is no longer on the page.
    tampered = [{**i, "id": i["id"] + "-tampered", "quote": tamper(i["quote"]), "label": "NOT_ON_PAGE"} for i in supports]
    return supports, refutes, tampered


def tamper(quote: str) -> str:
    """Swaps the first number or longest word, so the quote reads naturally but is not on the page."""
    if re.search(r"\d", quote):
        return re.sub(r"\d", lambda m: str((int(m.group()) + 3) % 10), quote, count=2)
    longest = max(re.findall(r"[A-Za-z]{5,}", quote), key=len)
    return quote.replace(longest, longest[::-1].capitalize(), 1)


async def main():
    await store.connect()
    await seed_cache()
    answerable, unanswerable = await squad_items(PER_ROLE)
    hotpot = await hotpot_items(PER_ROLE)
    supports, refutes, tampered = await fever_items(PER_ROLE)
    bank = {
        "version": VERSION,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "sources": SOURCES,
        "note": "Items were re-checked against Wikipedia on the build date; only items still valid on the live page were kept.",
        "items": {
            "squad_answerable": answerable, "squad_unanswerable": unanswerable,
            "hotpot": hotpot,
            "fever_supports": supports, "fever_refutes": refutes, "fever_tampered": tampered,
        },
    }
    path = DATA / "bench" / f"{VERSION}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(bank, ensure_ascii=False, indent=1), encoding="utf-8")
    print({k: len(v) for k, v in bank["items"].items()}, "->", path)
    await store.close()


if __name__ == "__main__":
    asyncio.run(main())
