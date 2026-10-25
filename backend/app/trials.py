"""Trial pool per role and the code that grades each answer. No LLM grading: a trial is a known-answer test."""
import random
import re

from . import rules
from .sources import normalize, quote_in, source_text, wiki_text, wiki_url

# Known facts: the question, the article that holds the answer, and a string the right answer must contain.
FACTS = [
    {"q": "In what year was the Eiffel Tower completed?", "title": "Eiffel Tower", "expect": "1889"},
    {"q": "What is the chemical symbol for gold?", "title": "Gold", "expect": "Au"},
    {"q": "In what year did Apollo 11 land on the Moon?", "title": "Apollo 11", "expect": "1969"},
    {"q": "Who wrote the novel Pride and Prejudice?", "title": "Pride and Prejudice", "expect": "Austen"},
    {"q": "Who painted the Mona Lisa?", "title": "Mona Lisa", "expect": "Leonardo"},
    {"q": "Who developed the theory of general relativity?", "title": "General relativity", "expect": "Einstein"},
    {"q": "Who discovered penicillin?", "title": "Penicillin", "expect": "Fleming"},
]

# The true claim is the page's own first sentence, fetched live, so the trial never goes stale.
VERIFIER_TRIALS = [
    {"title": "Eiffel Tower", "false": "The Eiffel Tower is a stone bridge in Berlin."},
    {"title": "Jupiter", "false": "Jupiter is the smallest planet in the Solar System."},
    {"title": "Nile", "false": "The Nile is a mountain range in South America."},
    {"title": "Canberra", "false": "Canberra is the largest city in Brazil."},
    {"title": "Penicillin", "false": "Penicillin is a type of volcanic rock."},
]

GENERATOR_TRIALS = [
    {"question": "What is Mount Everest?", "claims": [
        {"id": "c1", "text": "Mount Everest is the highest mountain above sea level."},
        {"id": "c2", "text": "Mount Everest is in the Himalayas."},
        {"id": "c3", "text": "Mount Everest lies on the border of Nepal and China."},
    ]},
    {"question": "What is the Pacific Ocean?", "claims": [
        {"id": "c1", "text": "The Pacific Ocean is the largest ocean on Earth."},
        {"id": "c2", "text": "The Pacific lies between Asia and Australia and the Americas."},
    ]},
]


def first_sentence(text: str) -> str:
    m = re.match(r"^[\s\S]*?[.!?](\s|$)", text)
    return (m.group(0) if m else text[:200]).strip()


def cited_ids(answer: str) -> list[str]:
    return re.findall(r"\[(c\d+)\]", answer or "")


class Trial:
    """inputs: one or more inputs to send; grade(outputs) -> {pass, reason}."""

    def __init__(self, inputs, grade):
        self.inputs, self.grade = inputs, grade


async def make_trial(role: str) -> Trial:
    if role == "planner":
        t = random.choice(FACTS)
        return Trial([{"question": t["q"]}], lambda outs: grade_planner(t, outs[0]))
    if role == "retriever":
        t = random.choice(FACTS)
        return Trial([{"sub_question": t["q"]}], lambda outs: grade_retriever(t, outs[0]))
    if role == "reader":
        t = random.choice(FACTS)
        inp = {"sub_question": t["q"], "sources": [{"title": t["title"], "url": wiki_url(t["title"])}]}
        return Trial([inp], lambda outs: grade_claims(t, (outs[0] or {}).get("facts"), source_text))
    if role == "reasoner":
        t = random.choice(FACTS)
        page = {"url": wiki_url(t["title"]), "text": (await wiki_text(t["title"]))[:40000]}
        facts = rules.pick_sentences(t["q"], [page], 12)
        inp = {"sub_question": t["q"], "question": t["q"], "facts": facts}
        return Trial([inp], lambda outs: grade_claims(t, (outs[0] or {}).get("claims"), source_text))
    if role == "verifier":
        t = random.choice(VERIFIER_TRIALS)
        quote = first_sentence(await wiki_text(t["title"]))
        cases = [{"claim": quote, "expect": "supported"}, {"claim": t["false"], "expect": "unsupported"}]
        inputs = [{"claim": c["claim"], "source_url": wiki_url(t["title"]), "quote": quote} for c in cases]
        return Trial(inputs, lambda outs: grade_verifier(cases, outs))
    t = random.choice(GENERATOR_TRIALS)
    return Trial([t], lambda outs: grade_generator(t, outs[0]))


async def grade_planner(t, out):
    subs = (out or {}).get("subquestions")
    if not isinstance(subs, list) or not 1 <= len(subs) <= 3:
        return {"pass": False, "reason": "expected 1 to 3 sub-questions"}
    if not all(isinstance(s, dict) and s.get("question") and s.get("search") for s in subs):
        return {"pass": False, "reason": "every sub-question needs a question and a search query"}
    key = normalize(t["title"]).split()[0]
    if not any(key in normalize(f"{s['question']} {s['search']}") for s in subs):
        return {"pass": False, "reason": f"plan lost the subject ({t['title']})"}
    return {"pass": True}


async def grade_retriever(t, out):
    sources = (out or {}).get("sources")
    if not isinstance(sources, list) or not sources:
        return {"pass": False, "reason": "no sources returned"}
    if not any(isinstance(s, dict) and normalize(t["title"]) in normalize(s.get("title", "")) for s in sources):
        return {"pass": False, "reason": f"did not find the {t['title']} article"}
    return {"pass": True}


async def grade_claims(t, items, fetch_text):
    """Reader facts and reasoner claims: one must carry the expected answer, and its quote must be on its source page."""
    if not isinstance(items, list) or not items:
        return {"pass": False, "reason": "nothing returned"}
    hits = [c for c in items if isinstance(c, dict) and normalize(t["expect"]) in normalize(f"{c.get('text', '')} {c.get('quote', '')}")]
    if not hits:
        return {"pass": False, "reason": f"wrong answer (expected {t['expect']})"}
    for c in hits:
        try:
            text = await fetch_text(c.get("source_url", ""))
        except Exception:  # noqa: BLE001
            text = ""
        if quote_in(text, c.get("quote")):
            return {"pass": True}
    return {"pass": False, "reason": "quote not found on its source page"}


async def grade_verifier(cases, outs):
    for i, c in enumerate(cases):
        verdict = (outs[i] or {}).get("verdict") if i < len(outs) else None
        if verdict != c["expect"]:
            return {"pass": False, "reason": f"said {verdict or 'nothing'} for a {c['expect']} claim"}
    return {"pass": True}


async def grade_generator(t, out):
    answer = (out or {}).get("answer")
    if not isinstance(answer, str) or not answer.strip():
        return {"pass": False, "reason": "empty answer"}
    cited = cited_ids(answer)
    if not cited:
        return {"pass": False, "reason": "no citations"}
    allowed = {c["id"] for c in t["claims"]}
    bad = next((x for x in cited if x not in allowed), None)
    return {"pass": False, "reason": f"cited unknown claim {bad}"} if bad else {"pass": True}
