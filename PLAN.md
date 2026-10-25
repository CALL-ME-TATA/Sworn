# Build Plan: Trusted Agent Hiring on Solana

> Historical: this is the plan for the first, Node-only version (backed up in `legacy-node-app.zip`).
> The current build (Python/FastAPI/LangGraph, Next.js, Postgres, Redis, Docker) is described in README.md.

An orchestrator that hires its research team from the Solana Agent Registry for each question,
trusts only agents that pass its checks, and writes every agent's score back on-chain.
Target: Track 2, Challenge 01 (Best Use of the Solana Agent Registry).

Pitch line: **a trust layer that lets any multi-agent system hire safely from the registry, shown on research.**
We claim reliable runs and traceable claims, not smarter answers.

---

## 1. What we found on devnet (checked 24 Oct 2026)

Counted by `registryStats()` in `src/registry.js`, which pages through every agent on the devnet indexer
`https://8004-indexer-dev.qnt.sh/v2/graphql`. The results page shows these numbers live.

| Fact | Number | What it means for us |
|---|---|---|
| Agents registered on devnet | 4,823 | The registry is busy, mostly with test entries |
| Agents with a readable profile | 734 | 85% have no readable profile at all |
| Agents with an A2A or MCP endpoint | 86 | Under 2% of agents can even be called |
| Agents declaring OASF skills | 24 | Skill-based discovery finds almost nothing from others |
| Third-party agents with our three research skills | 0 | We register our own research agents |

In a live check, the first third-party agent with an endpoint (COLA) did not respond.

This is live evidence for our problem statement: an open registry is mostly agents you cannot call.
We show these numbers in the demo.

Other facts confirmed:

- **HTTPS registration links work.** Devnet has agents with `agentURIType: HTTP`, and the indexer reads
  their files. We do not need Pinata or IPFS.
- **The indexer can filter agents by owner, creator, collection, trust tier, feedback count, but not by skill.**
  We pull profiles and filter skills ourselves.
- **The indexer returns at most 250 agents per page.** Discovery pages with `skip`.
- **An agent's `id` in the indexer is its asset address** (base58), the same value the SDK calls `asset`.
- **Validation functions in the SDK are archived** (they throw since v0.5.0). Verifier verdicts go into feedback.

---

## Status (24 Oct)

Everything runs end to end on devnet, in rule-based mode (`LLM=off`; no API credit yet).

- **Registered:** all 6 agents, owned by the OWNER wallet. Assets in `data/agents.json`.
- **Full run with failover** (`--kill`): retriever-a killed after the first sub-question, retriever-b took over
  (32 ms with a warm cache, 3.1 s cold), 6/6 claims tagged and supported, 8/8 feedback transactions on-chain.
- **Trial gate:** `bad-liar` and `bad-slow` always rejected; all 3 third-party agents with endpoints were dead.
- **Feedback loop works:** after a few runs, bad agents are rejected at the reputation step (average 0 over
  3+ ratings) without a trial.
- **Baseline (5 questions):** unsupported claims in the final answer, fixed team 17%, ours 0%. The fixed
  team only meets `bad-liar` on questions that split into two sub-questions (3 of 5).
- **Tests:** 8 pass (`npm test`).

Not done yet: LLM mode untested (needs API credit), not deployed (profile links point at `localhost:3001`;
after deploying, update them with the SDK's `setAgentUri`).

Found while running, and fixed:

- **`getSummary` reads ATOM by default**, which stays 0 for agents registered without ATOM. `getScore` passes
  `minScore: 0` so the SDK averages the real feedback scores.
- **One unlucky trial was a permanent ban.** The reputation gate now needs 3+ ratings (`MIN_FEEDBACKS`).
- **A failed run skipped feedback.** Screening results are now written even when no agent passes for a role.
- **Wikipedia rate limits** (HTTP 429): REST endpoints, 5 requests/s pacing, a disk cache
  (`data/wiki-cache.json`), and a contact in the User-Agent (`WIKI_CONTACT`), as Wikimedia asks.
- **Page text** is article paragraphs only, so infobox and caption text never become claims.
- **The "largest planet" trial** was unfair (Wikipedia ranks a list page first); replaced with "Mona Lisa".

Changes from the first draft of this plan, found while building:

- **Two wallets.** `OWNER_PRIVATE_KEY` registers our agents, `ORCHESTRATOR_PRIVATE_KEY` writes feedback, so no
  agent is rated by its own owner. `npm run keygen` creates both in `.env`.
- **Skills live on an OASF service entry.** The SDK's `buildRegistrationFileJson` writes skills into the `OASF`
  service, not at the top level, so each profile lists an A2A endpoint and an OASF entry.
- **`sdk.isItAlive` refuses localhost** and sends HEAD requests. `isAlive()` falls back to our own HEAD ping.
- **`src/sources.js`** holds Wikipedia search, page text and `quoteIn`, shared by agents, trials and the baseline.
- **Model:** set by `LLM_PROVIDER` and `MODEL` in `.env` (Groq `openai/gpt-oss-120b` in practice).

## 2. Decisions (gaps filled)

| Gap | Decision |
|---|---|
| Search by skill | One paginated indexer query for agents + their registration files, filter `oasfSkills` in our code |
| Where profiles live | Our agent server serves each profile at `https://<host>/agents/<name>/registration.json`; registered as an HTTPS link |
| Public URL for agents | Deploy the agent server to Render, so endpoints are reachable by the indexer and `isItAlive` |
| Third-party agents (the "you made them all" risk) | Discovery also pulls third-party agents that have an endpoint; they go through the same checks, and the report shows how many fail |
| Where retrievers get sources | Wikipedia API (free, no key). Retriever returns claims with exact quotes; verifier re-fetches the page and checks the quote is there |
| Validation registry archived | Verdicts written as feedback (`tag2` = outcome), run report linked in `feedbackUri` |
| Which LLM | An OpenAI-compatible API (Groq `openai/gpt-oss-120b`), or `LLM=off` for rules |
| Who tags claims with agent IDs | The orchestrator, because it knows which agent it called. Agents cannot fake their ID |
| Wallet | Fresh keypair from `npm run keygen`, funded from Phantom. Phantom key is never exported |
| OASF skill slugs | Retriever: `natural_language_processing/information_retrieval_synthesis/search`. Verifier: `natural_language_processing/analytical_reasoning/fact_verification`. Writer: `natural_language_processing/natural_language_generation/summarization` |

Skill slugs come from the SDK's [OASF list](https://github.com/QuantuLabs/8004-solana-ts/blob/main/docs/OASF.md).
Check them with `validateSkill(slug)` before registering.

---

## 3. How it works

```
question
  -> PLAN      orchestrator splits it into 2-3 sub-questions (one LLM call)
  -> HIRE      for each role (retriever, verifier, writer):
                 discover: indexer profiles whose oasfSkills match the role (+ 3 third-party agents for retriever)
                 reputation: skip agents with an average score below 40 (agents with no score pass)
                 alive: sdk.isItAlive(asset) must be live or partially
                 trial: one random known-answer task, graded by code
               -> main agent + backups
  -> RETRIEVE  each sub-question to the main retriever -> claims {text, source_url, quote}
  -> VERIFY    each claim to a verifier whose asset differs from the claim's producer
  -> WRITE     verified claims to the writer -> answer citing [c1], [c2] ...
  -> REPORT    runs/<run_id>.json
  -> FEEDBACK  one giveFeedback per agent touched, including trial failures
```

Failover: a task that times out is retried once. After 3 failures in a row, or a dead endpoint, the agent is
marked dead for the run and the next backup takes over. Progress is saved after every task, so only the
unfinished task is redone.

---

## 4. File structure

```
VVCE Hackathon/
  PLAN.md               this file
  README.md             what it is, how to run it (written last)
  package.json
  .env.example          keys the code needs (copy to .env)
  .gitignore
  src/
    config.js           all settings and the role -> skill map
    llm.js              ask(prompt) wrapper around the LLM API
    registry.js         all Solana calls: register, discover, isAlive, getScore, giveFeedback
    agents.js           Express server: our agents, their profiles, admin kill switch, results page
    trials.js           trial pool per role + graders
    orchestrator.js     the main agent (CLI)
    baseline.js         fixed-team baseline for comparison
  scripts/
    keygen.js           create the code's wallet
    register.js         register our agents on devnet -> data/agents.json
  data/
    questions.json      demo questions
    agents.json         our registered agents: name -> asset (written by register.js)
  public/
    index.html          results page
  runs/                 run reports and state files (gitignored)
```

Plus `src/sources.js` (Wikipedia and quote matching) and `test/graders.test.js`. No framework, no database.
Sections 5 to 12 describe the design; where they differ from the code, the code and the Status section win.

---

## 5. `src/config.js`

```js
export const CONFIG = {
  MAX_CANDIDATES: 8,        // trialled per role
  MIN_SCORE: 40,            // average feedback below this = skip (no score = allowed)
  TRIAL_TIMEOUT_MS: 15000,
  TASK_TIMEOUT_MS: 20000,
  BREAKER_FAILS: 3,         // consecutive failures before an agent is marked dead
  SUBQUESTIONS: 3,
  INDEXER: 'https://8004-indexer-dev.qnt.sh/v2/graphql',
};

export const ROLE_SKILLS = {
  retriever: ['natural_language_processing/information_retrieval_synthesis/search'],
  verifier:  ['natural_language_processing/analytical_reasoning/fact_verification'],
  writer:    ['natural_language_processing/natural_language_generation/summarization'],
};
```

---

## 6. `src/llm.js`

One exported function: `ask(prompt, { model, json })`. Returns text, or parsed JSON when `json` is true
(retry once on a parse failure). Uses `GROQ_API_KEY`. Everything else in the code calls only this.

---

## 7. `src/registry.js` and the scripts

| Function | Implementation |
|---|---|
| `sdk` | `new SolanaSDK({ cluster: 'devnet', signer })`; owner signer from `OWNER_PRIVATE_KEY`, feedback signer from `ORCHESTRATOR_PRIVATE_KEY` |
| `register(name, skills)` | `buildRegistrationFileJson({ name, description, services: [{ type: ServiceType.A2A, value: endpoint }], skills })`, served at `/agents/<name>/registration.json`, then `sdk.registerAgent(<that https URL>)`. Returns `result.asset` |
| `discover(role)` | GraphQL `agents(first: 250, skip: n) { id agentId registrationFile { name active a2aEndpoint mcpEndpoint oasfSkills } }`, paged until empty. Keep: skill match for the role. For the retriever role only, also add up to 3 third-party agents that have an endpoint, so the demo shows real agents being tested. Returns `[{ asset, name, endpoint, ours }]` |
| `isAlive(asset)` | `sdk.isItAlive(asset)` -> true when `status` is `live` or `partially` |
| `getScore(asset)` | `sdk.getSummary(asset)` -> average score, or null when there is no feedback |
| `giveFeedback(asset, r)` | `sdk.giveFeedback(asset, { value: r.score, score: r.score, tag1: r.role, tag2: r.outcome, endpoint: r.endpoint, feedbackUri: r.reportUrl })` |

`tag1` and `tag2` max 32 bytes, `endpoint` and `feedbackUri` max 250 bytes.
`tag2` values: `passed`, `trial-failed`, `dead`, `timeout`, `unsupported-claims`.

**`scripts/keygen.js`**: creates the owner and orchestrator keypairs in `.env` and prints both addresses.
Fund them from Phantom: about 0.2 SOL to the owner, 0.1 SOL to the orchestrator.

**`scripts/register.js`**: registers each agent listed in `src/agents.js`, writes `data/agents.json`.
Cost: about 0.009 SOL per agent, about 0.06 SOL for all 6.

Install on the day:

```
npm install 8004-solana @solana/web3.js express dotenv
```

---

## 8. `src/agents.js`: the agent server

One Express server. Every agent shares one request/response contract.

**Request** `POST /agents/<name>`

```json
{ "run_id": "run_017", "task_id": "t3", "role": "retriever", "input": { ... } }
```

**Response**

```json
{ "task_id": "t3", "output": { ... } }
```

| Agent | Role | Behaviour |
|---|---|---|
| `retriever-a` | retriever | Wikipedia search -> page text -> LLM picks claims with exact quotes |
| `retriever-b` | retriever | Same, different prompt. Backup for failover |
| `verifier-a` | verifier | Fetches `source_url` text, checks the quote is on the page, then LLM judges whether the quote supports the claim |
| `writer-a` | writer | Writes the answer from verified claims, citing `[c1]` style IDs only |
| `bad-liar` | retriever | Invents quotes and URLs. Must fail the trial |
| `bad-slow` | retriever | Sleeps 30 s. Must time out |

Input and output per role:

| Role | `input` | `output` |
|---|---|---|
| retriever | `{ sub_question }` | `{ claims: [{ text, source_url, quote }] }` |
| verifier | `{ claim, source_url, quote }` | `{ verdict: "supported" \| "unsupported" \| "unreachable", reason }` |
| writer | `{ question, claims: [{ id, text }] }` | `{ answer }` |

Other routes:

- `GET /agents/<name>/registration.json`: the agent's registration file.
- `GET /agents/<name>`: returns 200, so liveness checks see it as up.
- `POST /admin/kill/<name>` and `/admin/revive/<name>`: makes an agent return 503, for the failover demo.
- `GET /` serves `public/`, `GET /runs/<id>.json` serves reports (also the `feedbackUri`).

---

## 9. `src/trials.js`

About 10 trials per role, one picked at random per candidate. Graded by code only.

| Role | Trial | Passes when |
|---|---|---|
| retriever | Sub-question with a known fact, e.g. boiling point of water at sea level in Celsius | A claim's `quote` contains the expected token (`100`) **and** the quote appears in the text of its `source_url` |
| verifier | One true claim and one false claim, each with a real Wikipedia source | Says `supported` for the true one and `unsupported` for the false one |
| writer | Three claims `c1` to `c3` | Answer cites at least one ID and only `c1` to `c3` |

Instant fail: timeout, non-JSON, wrong shape, HTTP error.
Quote matching normalises whitespace and case before comparing.

---

## 10. `src/orchestrator.js`

`npm run run -- "What causes coral bleaching?"`

1. **Plan**: `ask()` with Sonnet returns 2 to 3 sub-questions as JSON.
2. **Hire**: per role, `discover` -> drop low scores -> `isAlive` -> trials in parallel -> sort passers by
   score -> `{ main, backups }`. No passer for a role -> stop with a clear message.
3. **Retrieve**: each sub-question to the retriever. Claims get IDs `c1`, `c2` ... and `produced_by` = asset.
4. **Verify**: each claim to a verifier with a different asset from `produced_by`.
5. **Write**: verified claims only. Reject the answer if it cites an unknown or unverified ID; retry once.
6. **Report**: write `runs/<run_id>.json` and `runs/latest.json`.
7. **Feedback**: one `giveFeedback` per agent touched. Score = share of its tasks that succeeded x 100;
   trial failures and dead agents get 0. Store the transaction signatures in the report.

Every call goes through one `callAgent(agent, task)` with the timeout, retry and breaker.
Run state is saved to `runs/<run_id>.state.json` after every task.

**Report shape**

```json
{
  "run_id": "run_017",
  "question": "...",
  "answer": "... [c1] ...",
  "claims": [{ "id": "c1", "text": "...", "source_url": "...", "quote": "...",
               "produced_by": "<asset>", "verified_by": "<asset>", "status": "supported" }],
  "hiring": [{ "asset": "...", "name": "...", "role": "retriever", "ours": false,
               "stage": "alive", "result": "failed", "reason": "endpoint dead" }],
  "failovers": [{ "from": "<asset>", "to": "<asset>", "task_id": "t2", "took_ms": 4200 }],
  "feedback_tx": ["<signature>"],
  "metrics": { "claims_tagged_pct": 100, "bad_agents_rejected": 2, "third_party_tried": 3,
               "third_party_passed": 0, "failover_ms": 4200 }
}
```

---

## 11. `public/index.html`

One page, fetches `/runs/latest.json`. Shows:

1. The question and answer, citations linked to claims.
2. Claims table: claim, quote, source link, produced by, verified by, status.
3. Hiring table: every candidate, the stage it reached, pass or fail and why. Ours vs third-party.
4. Failovers with takeover time.
5. Feedback transactions, each linking to `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

---

## 12. Baseline and KPIs

`src/baseline.js` runs the same questions with a hardcoded team (`retriever-a`, `bad-liar`, `writer-a`),
no trials, no verification. Then our verifier checks every baseline claim, to count unsupported ones.

| KPI | Target | How we measure |
|---|---|---|
| Claims tagged with source and agent | 100% | Count in the report |
| Deliberately bad agents rejected | 100% (2 of 2) | Hiring table |
| Run completes when a retriever is killed mid-run | 5 of 5 tries | Kill switch during the run |
| Backup takes over | under 30 s | `failover_ms` |
| Feedback written for every agent touched | 100% | `feedback_tx` count |
| Unsupported claims vs baseline | fewer | 5 questions, shown as an early result |

---

## 13. The day (27 Oct, 10:30 to 4:00, lunch 1:00 to 2:00)

| Time | Person A: Solana (`registry.js`, scripts) | Person B: agents and page (`agents.js`, `trials.js`, `llm.js`) |
|---|---|---|
| 10:30 to 11:15 | `npm install`, keygen and fund, deploy empty server to Render | `llm.js`, agent server with the 6 agents |
| 11:15 to 12:00 | `register.js`: all 6 agents on devnet | Push agents to Render, test each by hand |
| 12:00 | **Milestone: agents registered and answering** | |
| 12:00 to 1:00 | `discover`, `isAlive`, `getScore` | `trials.js` |
| 1:00 to 2:00 | Lunch | Lunch |
| 2:00 to 3:00 | `giveFeedback`, report links | `orchestrator.js` with failover |
| 3:00 to 3:30 | Baseline on 5 questions | `index.html` |
| 3:30 to 4:00 | Code freeze, rehearse, backup video, README | Same |

Fallback: if `discover` fails by 1:00, read `data/agents.json` instead and keep going. Feedback stays on-chain.

**Demo (3 min)**: devnet numbers from section 1 -> ask a question -> candidates appear, bad and third-party
agents rejected -> kill `retriever-a`, `retriever-b` takes over -> answer with tagged claims -> feedback
transaction on Explorer -> baseline vs ours.

---

## 14. Before the day

- [ ] Groq API key
- [ ] Render account (event gives credits). Free instances sleep when idle: wake the server before the demo
- [ ] Second teammate's Phantom wallet with devnet SOL
- [ ] GitHub repo (later; we keep changes local for now)
- [ ] Read the SDK [Quickstart](https://github.com/QuantuLabs/8004-solana-ts/blob/main/docs/QUICKSTART.md) together
- [ ] Write 5 demo questions in `data/questions.json`
- [ ] Decide who is Person A and who is Person B

## 15. Still unverified (test first thing on the day)

- What URL `isItAlive` pings and what counts as live. If our agents show `not_live`, fall back to our own
  `GET` with a 5 s timeout.
- Whether `buildRegistrationFileJson` rejects unknown skill slugs. Run `validateSkill()` first.
- Whether `feedbackFileHash` needs a helper from the SDK. Leave it out if it costs time.
