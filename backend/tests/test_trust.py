"""The fake-reputation rules: each one gets a small hand-made registry. Run: pytest"""
from app import trust


def rating(i, agent, owner, client, at, score=90.0):
    return {"id": f"r{i}", "agent": agent, "owner": owner, "client": client, "score": score, "at": at, "revoked": False}


def flags_of(rows):
    return trust.analyze(rows)[0]


def test_independent_customers_are_not_flagged():
    rows = [rating(i, "A1", "alice", f"user{i}", 1000 * i) for i in range(5)]
    assert not any(flags_of(rows).values())


def test_a_second_wallet_that_only_rates_one_owner_is_captive():
    rows = [rating(i, f"A{i % 2}", "alice", "alt", 1000 * i) for i in range(3)] + [rating(9, "A0", "alice", "user", 50_000)]
    f = flags_of(rows)
    assert all("captive" in f[f"r{i}"] for i in range(3)) and f["r9"] == []


def test_ratings_seconds_apart_on_one_owner_are_a_burst_but_other_owners_are_not():
    rows = [rating(1, "A1", "alice", "bot", 100), rating(2, "A2", "alice", "bot", 105),
            rating(3, "B1", "bob", "bot", 107), rating(4, "C1", "carol", "bot", 5000)]
    f = flags_of(rows)
    assert "burst" not in f["r1"] and "burst" in f["r2"] and "burst" not in f["r3"]


def test_one_wallet_behind_all_of_an_agents_ratings_is_single_source():
    rows = [rating(i, "A1", "alice", "fan", 1000 * i) for i in range(3)] + [rating(5, "B1", "bob", "fan", 9000)]
    assert all("single_source" in flags_of(rows)[f"r{i}"] for i in range(3))


def test_two_operators_rating_each_other_is_a_ring():
    rows = [rating(1, "A1", "alice", "bob", 100), rating(2, "B1", "bob", "alice", 5000), rating(3, "C1", "carol", "alice", 9000),
            rating(4, "B1", "bob", "user", 20_000)]
    f = flags_of(rows)
    assert "ring" in f["r1"] and "ring" in f["r2"] and "ring" not in f["r3"]


def test_independent_score_leaves_out_flagged_ratings_and_operator_wallets():
    rows = [rating(i, "A1", "alice", "alt", 1000 * i, 100.0) for i in range(5)]            # a captive second wallet
    rows += [rating(10 + i, "A1", "alice", f"user{i}", 100_000 * (i + 1), 40.0) for i in range(3)]
    rows += [rating(20, "A1", "alice", "us", 900_000, 100.0)]
    flags, report = trust.analyze(rows)
    a = report["agents"][0]
    assert a["raw"] == 80.0 and a["independent"] == 55.0 and a["verdict"] == "mostly_flagged"
    trust._state = {"flags": flags, "by_agent": {"A1": rows}, "report": report}
    s = trust.agent_score("A1", exclude={"us"})
    assert s["average"] == 40.0 and s["count"] == 3 and s["ignored"] == {"captive": 5, "operator": 1}
    assert trust.agent_score("unknown") is None
