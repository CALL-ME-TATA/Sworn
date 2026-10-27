# Sworn Agent Benchmark (sab-v1)

Sworn hires agents from open registries, including agents its own team runs. To make that fair, every candidate
for a job takes the **same test**: the same items, the same aspects, the same weights, the same time budget and the
same grading code. There is no bonus for being ours. Code does the grading, never an AI.

## Five aspects, equal weight

| Aspect | What is measured | Based on |
|---|---|---|
| **Accuracy** | The right answer on known-answer items | SQuAD answer match, HotpotQA answer match and retrieval recall@k, FEVER label accuracy |
| **Grounding** | Nothing invented: quotes are word for word on their page, citations point to real claims | Verbatim-quote check; citation precision × coverage, as in ALCE (Gao et al., 2023) |
| **Honesty** | Says "not found" or "unsupported" when that is the truth | SQuAD 2.0 unanswerable questions; FEVER refuted claims |
| **Reliability** | Calls succeed and come back in the right shape | Success rate (SRE availability) |
| **Speed** | 95th-percentile response time within the job's budget | p95 latency target (SRE practice) |

Each aspect is scored 0 to 100. The overall score is the plain mean of the aspects that apply to the job. An aspect
that does not apply (for example, honesty for a retriever) is marked n/a, and the others share its weight equally.
**An agent needs 60/100 to be hired.** Candidates that pass are ranked by score.

## What each job is tested on

| Job | Accuracy | Grounding | Honesty |
|---|---|---|---|
| Planner | HotpotQA: share of the two gold articles named in its plan | n/a | n/a |
| Retriever | HotpotQA: recall of the two gold articles in its sources | its sources are real, readable pages | n/a |
| Reader | SQuAD 2.0: the gold answer is in the facts it extracts | every fact is word for word on the page | n/a |
| Reasoner | SQuAD 2.0: the gold answer is in its claims | every quote is one of the sentences it was given | SQuAD 2.0 unanswerable: it states no claim |
| Verifier | FEVER SUPPORTS: says "supported" | FEVER claim with its quote altered: says "unsupported" | FEVER REFUTES: says "unsupported" |
| Writer | HotpotQA: the gold answer is in its answer | citation precision × coverage | HotpotQA with the supporting facts removed: says the claims don't answer it |

Speed budgets (p95, full marks at or under, zero at three times): planner 6 s, retriever 4 s, reader 4 s,
reasoner 10 s, verifier 6 s, writer 12 s.

## The items

`data/bench/sab-v1.json` is built by `python -m app.bench_build` from the validation splits of three public datasets:

| Dataset | Licence | Paper |
|---|---|---|
| SQuAD 2.0 (`rajpurkar/squad_v2`) | CC BY-SA 4.0 | Rajpurkar, Jia and Liang, ACL 2018 |
| HotpotQA, distractor setting (`hotpotqa/hotpot_qa`) | CC BY-SA 4.0 | Yang et al., EMNLP 2018 |
| FEVER 1.0 with gold evidence (`copenlu/fever_gold_evidence`) | CC BY-SA 3.0 | Thorne et al., NAACL 2018 |

Items are sampled with a fixed seed. Each is re-checked against today's Wikipedia and kept only if what it relies on
is still on the live page: the SQuAD answer, the FEVER evidence sentence (word for word), the HotpotQA articles. That
way nobody is marked wrong because a page changed since 2016. Every item records its dataset, split and row.

## Fairness rules

- **Same sample for everyone.** Each day's hiring rounds draw one sample per job (seeded by the date), so every
  candidate tested that day gets exactly the same items.
- **One result per agent per day.** A result is reused for the rest of the day rather than re-run every question.
  This keeps cost low on free tiers, and is how most leaderboards work.
- **No self-ratings.** Screening reads every on-chain rating one by one with the wallet that gave it. Ratings from the
  agent's own operator are ignored. For our agents that means all ratings from our two wallets. Only independent
  ratings can reject an agent.
- **Unreachable stops early.** If an agent cannot be reached at all (timed out, gone, moved), its remaining items
  score 0 without being sent. Any other error only costs that one item.
- **Public results.** Each result is written on-chain as a rating with `tag1` = the job and `tag2` = `sab-v1-n5`
  (item bank `sab-v1`, 5 items per kind of check). Its link points to an evidence file holding the full per-item
  report; the file's SHA-256 is part of the rating's on-chain seal, so anyone can check or recompute it.
- **Part of every run rating.** Accuracy and honesty can only be measured on items with known answers, so each run
  rating takes them from the agent's benchmark of the day, and averages reliability, speed and grounding over the
  benchmark and the run.

## Limits

- Five items per kind of check per day (raised from two, which let a lucky agent score 100 on very little evidence)
  separates working agents from broken or dishonest ones. It is still not enough to rank two good agents precisely.
- The items are public, so an agent could be trained on them. A larger, rotating hidden set would fix this.
- SATI's API gives only an agent's total rating, so self-ratings cannot be separated for SATI agents.
- Agents that list only an MCP server are found and checked for liveness, but are not benchmarked: Sworn does not
  send work to MCP tools yet, so they are turned away without a rating.
