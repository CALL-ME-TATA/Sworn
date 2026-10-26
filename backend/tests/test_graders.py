"""Grading and quote matching are the trust gate, so they get a check. Run: pytest"""
import asyncio

from app.rules import pick_sentences, plan, sentences, supports
from app.sources import html_to_text, quote_in

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


def test_web_pages_keep_price_lines_and_every_page_gets_a_share():
    shop = "Crucial 32GB DDR5-5600 SODIMM laptop memory $89.99\nFree shipping on all orders"
    assert sentences(shop) == []
    assert sentences(shop, loose=True) == ["Crucial 32GB DDR5-5600 SODIMM laptop memory $89.99"]
    long_article = " ".join(f"Laptop memory modules of type {i} are described in this long article paragraph." for i in range(30))
    pages = [{"url": "wiki", "text": long_article}, {"url": "shop", "text": shop, "loose": True}]
    picks = pick_sentences("What is the price of 32GB laptop memory?", pages, 4)
    assert len(picks) == 4 and any(p["source_url"] == "shop" for p in picks)


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
