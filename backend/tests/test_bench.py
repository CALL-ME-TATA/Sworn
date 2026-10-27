"""The standard benchmark's scoring: the same code grades every agent, so it gets checks. Run: pytest"""
import asyncio

from app import bench
from app.orchestrator import cited_ids, split_citations


def test_answer_match_is_squad_style():
    assert bench._answer_hit(["France"], "Normandy is a region in France.")
    assert bench._answer_hit(["8-track"], "He developed the 8 track cartridge.")
    assert not bench._answer_hit(["France"], "Normandy is in Europe.")


def test_gold_article_found_ignoring_its_bracketed_qualifier():
    assert bench._title_hit("Jackie (2016 film)", "Jackie | Natalie Portman")
    assert bench._title_hit("Bill Lear", "Learjet | Bill Lear")
    assert not bench._title_hit("Bill Lear", "Learjet")


def test_citations_need_known_ids_and_a_citation_on_every_sentence():
    allowed = {"c1", "c2"}
    assert bench._citations("Fleming found it in 1928. [c1] It saved many lives. [c2]", allowed) == 1.0
    assert bench._citations("Fleming found it in 1928. [c1] It saved many lives. [c9]", allowed) == 0.5
    assert bench._citations("Fleming found it in 1928. [c1] It saved many lives and changed medicine.", allowed) == 0.5
    assert bench._citations("No citations at all here, just a long sentence.", allowed) == 0.0
    assert cited_ids("x [c1] y [c12]") == ["c1", "c12"]
    assert split_citations("It sank. [c1 c2, c5] It was 1912. [c3]") == "It sank. [c1][c2][c5] It was 1912. [c3]"


def test_quotes_must_come_from_the_given_facts():
    facts = [{"quote": "The tower was completed in 1889."}]
    assert bench._quotes_from([{"quote": "The tower was completed in 1889."}], facts) == 1.0
    assert bench._quotes_from([{"quote": "Experts agree it was 1890."}], facts) == 0.0
    assert bench._quotes_from([], facts) == 1.0


def test_speed_full_marks_within_budget_and_zero_at_three_times():
    assert bench.speed_score("verifier", [1, 2, 5.9]) == 100.0
    assert bench.speed_score("verifier", [12]) == 50.0
    assert bench.speed_score("verifier", [18]) == 0.0
    assert bench.speed_score("verifier", []) == 0.0


def test_aspects_are_weighted_equally_and_missing_ones_share_the_weight():
    r = bench.combine("retriever", {"accuracy": [1, 0.5], "grounding": [1]}, calls_ok=2, calls=2, seconds=[1, 1])
    assert set(r["aspects"]) == {"accuracy", "grounding", "reliability", "speed"}  # honesty does not apply to retrievers
    assert all(w == 0.25 for w in r["weights"].values())
    assert abs(r["score"] - (75 + 100 + 100 + 100) / 4) <= 0.05  # the plain mean, rounded to one decimal


def test_same_items_for_every_candidate_in_a_round():
    a = [c["item"] for c in bench.sample("verifier", "2026-10-27")]
    b = [c["item"] for c in bench.sample("verifier", "2026-10-27")]
    assert a == b and len(a) == 3 * bench.PER_KIND


def test_a_liar_and_a_dead_agent_fail_and_an_honest_one_passes():
    checks = bench.sample("reasoner", "2026-10-27")

    answers = {i["question"]: i["answers"] for i in bench.bank()["items"]["squad_answerable"]}

    async def honest(inp):  # states the sentence that holds the answer, and nothing when the question has none
        if inp["question"] not in answers:
            return {"claims": []}, 0.5, None, False
        f = next(f for f in inp["facts"] if bench._answer_hit(answers[inp["question"]], f["quote"]))
        return {"claims": [{"text": f["quote"], "quote": f["quote"], "source_url": f["source_url"]}]}, 0.5, None, False

    async def liar(inp):
        return {"claims": [{"text": "The answer is 42.", "quote": "Experts agree it is 42.", "source_url": "x"}]}, 0.5, None, False

    async def dead(inp):
        return None, 30.0, "timeout", True

    async def fails_fast(inp):  # answers instantly, but never with a valid reply: no speed points for that
        return None, 0.01, "HTTP 308 redirect (agent moved)", False

    good = asyncio.run(bench.run("reasoner", "2026-10-27", honest))
    bad = asyncio.run(bench.run("reasoner", "2026-10-27", liar))
    gone = asyncio.run(bench.run("reasoner", "2026-10-27", dead))
    assert good["score"] >= 90, good
    assert bad["score"] < 60 and bad["aspects"]["grounding"] == 0 and bad["aspects"]["honesty"] == 0
    assert gone["score"] == 0 and sum("not sent" in d.get("error", "") for d in gone["items"]) > 0
    assert asyncio.run(bench.run("reasoner", "2026-10-27", fails_fast))["score"] == 0
