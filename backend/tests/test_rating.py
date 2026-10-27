"""Per-run ratings use the benchmark's aspects; evidence files hash the same every time. Run: pytest"""
import hashlib

from app.orchestrator import rate
from app.store import canonical


def stats(**kw):
    return {"ok": 0, "fail": 0, "claims": 0, "unsupported": 0, "secs": [], "grounding": []} | kw


def test_a_fast_useless_retriever_no_longer_gets_full_marks():
    r = rate("retriever", stats(ok=3, secs=[0.5, 0.6, 0.4], grounding=[0.0, 0.0, 1.0]))
    assert r["aspects"] == {"grounding": 33.3, "reliability": 100.0, "speed": 100.0} and r["score"] == 77.8


def test_reasoner_grounding_is_the_share_of_its_claims_confirmed():
    r = rate("reasoner", stats(ok=2, secs=[3, 4], claims=5, unsupported=1))
    assert r["aspects"]["grounding"] == 80.0 and r["score"] == round((80 + 100 + 100) / 3, 1)


def test_a_slow_verifier_loses_speed_and_a_dead_one_scores_zero():
    assert rate("verifier", stats(ok=2, secs=[12, 12]))["aspects"] == {"reliability": 100.0, "speed": 50.0}
    assert rate("retriever", stats(fail=1))["score"] == 0


def test_evidence_hash_does_not_depend_on_key_order():
    a = canonical({"score": 80, "agent": {"role": "reader", "name": "Fact Extractor"}})
    b = canonical({"agent": {"name": "Fact Extractor", "role": "reader"}, "score": 80})
    assert a == b and hashlib.sha256(a.encode()).hexdigest() == hashlib.sha256(b.encode()).hexdigest()
