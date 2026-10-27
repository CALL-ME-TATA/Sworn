"""Unit checks that do not need a live backend."""
from sworn_mcp.client import evidence_view, format_research_text, hiring_view, summarize_answer


def test_summarize_answer():
    report = {
        "run_id": "run_1",
        "question": "Q?",
        "answer": "A [c1]",
        "length": "short",
        "reasoning": "light",
        "source": "mcp",
        "metrics": {"claims": 1, "claims_supported": 1},
        "claims": [{"id": "c1", "status": "supported"}],
        "failovers": [],
    }
    out = summarize_answer(report)
    assert out["run_id"] == "run_1"
    assert out["answer"] == "A [c1]"
    assert out["source"] == "mcp"
    assert out["claims"] == 1
    assert out["claims_supported"] == 1


def test_format_research_text_is_prose_not_json():
    text = format_research_text({
        "run_id": "run_1",
        "answer": "Vector DBs store embeddings [c1].",
        "claims": 3,
        "claims_supported": 3,
        "length": "long",
        "reasoning": "high",
        "round_trip_ms": 1200,
        "failovers": 0,
        "ui": "http://localhost:3000/app#answer",
    })
    assert text.startswith("Vector DBs store embeddings")
    assert '"run_id"' not in text
    assert '"answer"' not in text
    assert "run_1" in text
    assert "3/3 claims supported" in text
    assert "debug_get_run" in text
    assert "Do not dump JSON" in text


def test_evidence_and_hiring():
    report = {
        "run_id": "run_1",
        "question": "Q?",
        "claims": [{
            "id": "c1", "sub_question": "s", "text": "t", "quote": "q",
            "source_url": "https://example.com", "status": "supported",
            "produced_by_name": "Reasoner", "verified_by_name": "Verifier",
        }],
        "hiring": [{
            "name": "planner-a", "role": "planner", "ours": True, "registry": "8004",
            "stage": "trial", "result": "passed", "reason": None, "score": 80,
            "bench": {"score": 90},
        }],
        "team": {"planner": [{"name": "planner-a", "asset": "x"}]},
        "failovers": [],
        "dead": [],
    }
    ev = evidence_view(report)
    assert ev["claims"][0]["id"] == "c1"
    assert ev["claims"][0]["produced_by"] == "Reasoner"
    hi = hiring_view(report)
    assert hi["hiring"][0]["bench"] == 90
