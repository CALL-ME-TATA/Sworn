"""Unit checks that do not need a live backend."""
from sworn_mcp.client import evidence_view, hiring_view, summarize_answer


def test_summarize_answer():
    report = {
        "run_id": "run_1",
        "question": "Q?",
        "answer": "A [c1]",
        "length": "short",
        "reasoning": "light",
        "source": "mcp",
        "metrics": {"claims": 1},
        "claims": [{"id": "c1"}],
        "failovers": [],
    }
    out = summarize_answer(report)
    assert out["run_id"] == "run_1"
    assert out["answer"] == "A [c1]"
    assert out["source"] == "mcp"
    assert out["claims"] == 1


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
