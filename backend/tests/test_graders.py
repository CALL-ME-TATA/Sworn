"""Grading and quote matching are the trust gate, so they get a check. Run: pytest"""
import asyncio

from app.rules import pick_sentences, plan, sentences, supports
from app.sources import html_to_text, quote_in
from app.trials import cited_ids, grade_claims, grade_generator, grade_planner, grade_retriever, grade_verifier

run = asyncio.run


def test_sentences_do_not_break_at_abbreviations_or_initials():
    text = ("Some ideas (e.g. homeopathy, vitalism) are incompatible with how vaccines work. "
            "Fleming found a crude extract of P. rubens in 1928 at St. Mary's Hospital.")
    assert sentences(text) == [
        "Some ideas (e.g. homeopathy, vitalism) are incompatible with how vaccines work.",
        "Fleming found a crude extract of P. rubens in 1928 at St. Mary's Hospital.",
    ]


def test_rule_verifier_rejects_claims_the_quote_does_not_carry():
    quote = "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France."
    assert supports(quote, quote)["supported"]
    assert not supports("The Eiffel Tower is a stone bridge in Berlin.", quote)["supported"]
    assert not supports("The Eiffel Tower was built in 1999.", quote)["supported"]
    jupiter = "Jupiter is the fifth planet from the Sun, and the largest in the Solar System."
    assert not supports("Jupiter is the smallest planet in the Solar System.", jupiter)["supported"]


def test_rule_reader_prefers_numbers_for_when_questions_and_rule_planner_splits():
    text = ("The Eiffel Tower is a famous lattice tower in Paris, France, and a global icon. "
            "Construction of the tower was completed in 1889 for the Exposition.")
    [first] = pick_sentences("In what year was the Eiffel Tower completed?", [{"url": "u", "text": text}], 1)
    assert "1889" in first["quote"]
    assert plan("What causes coral bleaching and where has it happened?", 3) == ["What causes coral bleaching?", "where has it happened? (coral bleaching)"]
    assert plan("How do vaccines work?", 3) == ["How do vaccines work?"]


def test_page_text_is_article_prose_only_even_when_attributes_contain_gt():
    html = """<table class="infobox"><tr><td>Coral bleachingPhenomenon</td></tr></table>
    <p data-mw='{"name":{"wt":"A <br /> B"}}'>Corals turn <b>white</b> when stressed.<sup class="mw-ref reference"><a>[1]</a></sup></p>
    <figure><figcaption>Bleached coral</figcaption></figure><p>Warm water &amp; light cause it.</p>"""
    assert html_to_text(html) == "Corals turn white when stressed.\nWarm water & light cause it."


PAGE = "The tower was completed in 1889 as the entrance to the World’s Fair."


async def fetch_text(_url):
    return PAGE


def test_quote_in_ignores_case_spacing_and_curly_quotes_and_rejects_short_or_missing():
    assert quote_in(PAGE, "the tower was  completed in 1889 as the entrance to the World's Fair")
    assert not quote_in(PAGE, "in 1889")
    assert not quote_in(PAGE, "The tower was completed in 1890.")
    assert not quote_in(PAGE, None)


def test_reasoner_and_reader_pass_only_with_the_right_answer_and_a_real_quote():
    t = {"expect": "1889"}
    good = [{"text": "Completed in 1889", "source_url": "x", "quote": "The tower was completed in 1889"}]
    wrong = [{"text": "Completed in 1890", "source_url": "x", "quote": "The tower was completed in 1890"}]
    fake = [{"text": "Completed in 1889", "source_url": "x", "quote": "Everyone agrees it was finished in 1889."}]
    assert run(grade_claims(t, good, fetch_text))["pass"]
    assert not run(grade_claims(t, wrong, fetch_text))["pass"]
    assert not run(grade_claims(t, fake, fetch_text))["pass"]
    assert not run(grade_claims(t, [], fetch_text))["pass"]
    assert not run(grade_claims(t, None, fetch_text))["pass"]


def test_planner_and_retriever_trials():
    t = {"title": "Eiffel Tower"}
    assert run(grade_planner(t, {"subquestions": [{"question": "When was the Eiffel Tower completed?", "search": "Eiffel Tower"}]}))["pass"]
    assert not run(grade_planner(t, {"subquestions": [{"question": "When was it built?", "search": "tower"}]}))["pass"]
    assert not run(grade_planner(t, {"subquestions": []}))["pass"]
    assert run(grade_retriever(t, {"sources": [{"title": "Eiffel Tower", "url": "u"}]}))["pass"]
    assert not run(grade_retriever(t, {"sources": [{"title": "Big Ben", "url": "u"}]}))["pass"]


def test_verifier_must_get_both_the_true_and_the_false_claim_right():
    cases = [{"expect": "supported"}, {"expect": "unsupported"}]
    assert run(grade_verifier(cases, [{"verdict": "supported"}, {"verdict": "unsupported"}]))["pass"]
    assert not run(grade_verifier(cases, [{"verdict": "supported"}, {"verdict": "supported"}]))["pass"]
    assert not run(grade_verifier(cases, [{"verdict": "supported"}]))["pass"]


def test_generator_must_cite_and_only_known_claims():
    t = {"claims": [{"id": "c1"}, {"id": "c2"}]}
    assert run(grade_generator(t, {"answer": "A [c1]. B [c2]."}))["pass"]
    assert not run(grade_generator(t, {"answer": "A [c1]. B [c9]."}))["pass"]
    assert not run(grade_generator(t, {"answer": "No citations here."}))["pass"]
    assert cited_ids("x [c1] y [c12]") == ["c1", "c12"]
