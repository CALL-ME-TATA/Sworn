"""Rule-based stand-ins for the LLM steps, used when LLM=off (no API credit needed).
The trust layer (discovery, trials, verification, failover, feedback) is identical in both modes."""
import re

from .sources import normalize

STOP = set((
    "a an the of in on at to for from by with and or is are was were be been it its this that these those "
    "what which who whom whose when where why how did does do has have had can could would should will about into than then "
    "there their they them as not no also such other more most many much some any each all one first year years"
).split())


def words(s) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9'-]*", normalize(s)) if w not in STOP and len(w) > 2]


def numbers(s) -> list[str]:
    return [n.replace(",", "") for n in re.findall(r"\d[\d,.]*\d|\d", str(s))]


def plan(question: str, max_parts: int) -> list[str]:
    """Splits on " and <question word>": "What causes X and where has it happened?" ->
    ["What causes X?", "where has it happened? (X)"]. Later parts carry the first part's keywords so search keeps the subject.
    ponytail: keyword carry-over, not real coreference; an LLM plans better."""
    parts = [p.strip() for p in re.split(r"\s+and\s+(?=(?:how|why|what|where|when|who|which)\b)", re.sub(r"\?+$", "", question), flags=re.I)]
    subject = " ".join(w for w in words(parts[0]) if not re.fullmatch(r"cause[sd]?|happen(ed|s)?|works?|makes?|use[sd]?", w))
    return [f"{p}?" if i == 0 or not subject else f"{p}? ({subject})" for i, p in enumerate(parts[:max_parts])]


# A full stop after "e.g", "St" or an initial like "P" does not end a sentence.
ABBREV = re.compile(r"(?:\b(?:e\.g|i\.e|etc|vs|approx|c|ca|Dr|Mr|Mrs|Ms|St|Jr|Sr|No|Fig|U\.S)|\b[A-Z])\.$")
SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"“(]?[A-Z0-9])")
END = re.compile(r"[.!?][\"”)]?$")


def sentences(text: str, loose: bool = False) -> list[str]:
    """Whole sentences of 40 to 320 characters. loose (web pages) also keeps short factual lines without a full stop,
    such as a price listing "Crucial 32GB DDR5-5600 SODIMM $89.99", as long as they contain a number."""
    out = []
    for para in re.split(r"\n+", text):
        current = ""
        for piece in SPLIT.split(para):
            current = f"{current} {piece}" if current else piece
            if not ABBREV.search(current):
                out.append(current.strip())
                current = ""
        if current:
            out.append(current.strip())
    whole = [s for s in out if 40 <= len(s) <= 320 and END.search(s)]
    if not loose:
        return whole
    lines = [s for s in out if 20 <= len(s) <= 320 and not END.search(s) and re.search(r"\d", s) and len(s.split()) >= 3]
    return whole + lines


WANTS_NUMBER = re.compile(r"\b(when|what year|in what year|how many|how much|how long|how far|what temperature|price|prices|cost|costs)\b", re.I)


def pick_sentences(question: str, pages: list[dict], count: int) -> list[dict]:
    """Sentences that share the most content words with the question. Returns [{quote, source_url}].
    Each page gets a fair share of the picks first, so one long article cannot crowd out the other sources."""
    q = set(words(question))
    wants_number = bool(WANTS_NUMBER.search(question))
    per_page = []
    for rank, p in enumerate(pages):
        scored = []
        for i, s in enumerate(sentences(p["text"], loose=p.get("loose", False))):
            overlap = len({w for w in words(s) if w in q})
            bonus = (1 if wants_number and re.search(r"\d", s) else 0) - rank * 0.5  # trust the top search hit more
            if overlap:
                scored.append((overlap + bonus - i * 0.001, s, p["url"]))  # ties go to earlier sentences
        per_page.append(sorted(scored, key=lambda x: -x[0]))
    share = max(1, count // max(1, len(pages)))
    picked = [x for page in per_page for x in page[:share]][:count]
    rest = sorted((x for page in per_page for x in page[share:]), key=lambda x: -x[0])
    best = sorted(picked + rest[:count - len(picked)], key=lambda x: -x[0])
    return [{"quote": s, "source_url": url} for _, s, url in best]


def supports(claim: str, quote: str) -> dict:
    """Supported only when the quote carries every number and every content word of the claim.
    Strict on purpose: one swapped word ("smallest" for "largest") flips a claim, and rule-mode claims are their quotes."""
    q = normalize(quote)
    if any(n not in q for n in numbers(claim)):
        return {"supported": False, "reason": "a number in the claim is not in the quote"}
    quote_words = set(words(quote))
    missing = [x for x in words(claim) if x not in quote_words]
    if missing:
        return {"supported": False, "reason": f"not in the quote: {', '.join(missing)}"}
    return {"supported": True, "reason": "every key word and number is in the quote"}


def write(claims: list[dict]) -> str:
    """Every verified claim, cited; a new paragraph every three claims so it reads as an answer, not a list."""
    sentences = [f"{re.sub(r'[.!?]+$', '', c['text'].strip())}. [{c['id']}]" for c in claims[:12]]
    return "\n\n".join(" ".join(sentences[i:i + 3]) for i in range(0, len(sentences), 3))
