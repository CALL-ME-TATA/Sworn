# Sworn: Trusted Agent Hiring

**Hire agents you can trust.** A multi-agent system that hires its research team from open Solana agent
registries (the [Solana Agent Registry](https://solana.com/agent-registry) / 8004, and SATI), and keeps only
agents that prove themselves. Every claim is traced to the agents that found it and checked it, and every
agent's performance is written back on-chain.

Team: Dancing Burgers.

## How a run works

The orchestrator is a LangGraph state machine (`backend/app/orchestrator.py`):

```
hire -> plan -> retrieve -> read -> reason -> verify -> generate -> record
            any step whose agent fails -> replace -> back to that step
```

1. **Discover agents by skill.** OASF skills in each registry profile, for six roles: planner, retriever,
   reader, reasoner, verifier and generator.
2. **Screen every candidate, the same way.** Ours or anyone's:
   - **Independent reputation:** every on-chain rating is read with the wallet that gave it, and ratings from
     the agent's own operator are ignored (for our agents, all of ours).
   - **Liveness:** the endpoint answers (an MCP handshake for MCP servers).
   - **Standard benchmark (sab-v1):** public SQuAD 2.0, HotpotQA and FEVER items, five equally weighted aspects
     (accuracy, grounding, honesty, reliability, speed) graded by code; 60/100 to be hired. See
     [docs/BENCHMARK.md](docs/BENCHMARK.md).
   Fail any one and it is out.
3. **Planner agent** splits the question into sub-questions, each with a Wikipedia query and a web query.
4. **Hired team.**
   - The retriever fetches sources: Wikipedia articles, plus web pages through Tavily when `TAVILY_API_KEY`
     is set (prices, release dates and recent events that Wikipedia doesn't record).
   - The reader extracts facts.
   - The reasoner states claims.
   - A verifier that is not the producer re-reads each quote on its source page.
   - The generator answers from verified claims only.
5. **Replace agent.** A timeout or crash marks the agent dead, and a screened backup takes over.
6. **Final answer** with sources and agent IDs on every claim.
7. **Write performance back** to the registry, one feedback transaction per agent, each linking the run
   report. New benchmark results are published too (`tag2` = `sab-v1`), each linking its full per-item report.

Ambiguous questions get a "which one?" prompt before the run. Dead ends get follow-up suggestions after it.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind CSS 4 (`frontend/`) |
| Backend / agents | Python, FastAPI, LangGraph (`backend/`) |
| Blockchain | Solana devnet, `@solana/web3.js`, the `8004-solana` SDK over the registry's Anchor programs (`registry/`) |
| Database | PostgreSQL (runs, validation records, feedback, comparisons), Redis (live run, Wikipedia cache, run lock, kill switch) |
| Infra / DevOps | Docker Compose, GitHub Actions (`.github/workflows/ci.yml`) |
| AI | OpenAI-compatible API: Groq `openai/gpt-oss-120b` by default, OpenAI or Gemini by `LLM_PROVIDER`, or `LLM=off` for rules |
| Monitoring | Prometheus metrics at `/metrics`, health at `/api/health`, Prometheus on :9090 |
| MCP | Stdio server in `mcp/` (`sworn-mcp`) for Cursor, Claude Desktop, VS Code, and other MCP hosts |

On "validation records": the 8004 SDK's validation registry is archived (its calls throw). Verifier verdicts
are stored as validation records in Postgres (`/api/runs/{id}/validations`). On-chain, each agent's feedback
carries its outcome and links the full run report.

## Run it

```bash
cp .env.example .env            # add GROQ_API_KEY, TAVILY_API_KEY and WIKI_CONTACT
cd registry && npm install && npm run keygen && cd ..   # two devnet wallets in .env; fund both from Phantom
docker compose up --build       # frontend :3000, backend :3001, registry bridge :3002, Postgres, Redis, Prometheus
docker compose exec backend python -m app.register      # put our 9 agents on devnet (once)
```

Open http://localhost:3000 and ask a question. Tick "Kill main retriever" to watch failover.
The `/app` debugger shows Plan, Sources, Evidence, Hiring, Validations, Timing, and a JSON Inspector; runs started via MCP are tagged `mcp`.

### MCP (IDE / AI hosts)

With the stack running on `:3001`:

```bash
cd mcp && pip install -e .
sworn-mcp   # stdio; set SWORN_API_URL if the API is not localhost:3001
```

**Flow:** call `sworn_init` first (returns what Sworn does, full command catalog, defaults, and call examples — surface the `guide` field; stop if the user only asked to init). On a later turn, prenamed `research_brief` / `research_standard` (default) / `research_deep` (or `run_research` with `length` / `reasoning`) reuses the same MCP session. Then `get_evidence` / `get_hiring` / `debug_*`. Other tools return `not_initialized` until `sworn_init` succeeds. Do not shell-wrap init + research.

**Cursor** (`.cursor/mcp.json` or user MCP settings):

```json
{
  "mcpServers": {
    "sworn": {
      "command": "sworn-mcp",
      "env": { "SWORN_API_URL": "http://localhost:3001" }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sworn": {
      "command": "sworn-mcp",
      "env": { "SWORN_API_URL": "http://localhost:3001" }
    }
  }
}
```

**VS Code** (MCP support / Copilot): same stdio command and `SWORN_API_URL` env.

Host skill packs (optional guidance for agents that load skills): [`skills/sworn-research/SKILL.md`](skills/sworn-research/SKILL.md), [`skills/sworn-debug/SKILL.md`](skills/sworn-debug/SKILL.md).

From the command line:

```bash
docker compose exec backend python -m app.orchestrator "How was penicillin discovered?" --kill --no-feedback
docker compose exec backend python -m app.baseline      # fixed team vs ours on data/questions.json
docker compose exec backend python -m app.bench_build   # rebuild the benchmark items from the public datasets
docker compose exec backend python -m pytest -q
docker compose run --rm registry npm run sati-sync       # refresh SATI agents from the chain
```

## Results (devnet, Groq)

| Measure | Result |
|---|---|
| Claims tagged with source and agent IDs | 100% |
| Deliberately bad agents rejected | 2 of 2, by the standard benchmark (Fake-Quote Bot 40/100, Slow Bot 0/100) |
| Our working agents on the benchmark | 75 to 100 out of 100 (retrievers score 0 on multi-hop accuracy; see below) |
| Outside registry agents hired | 0 of 8: 4 with low independent ratings, 2 not responding, 2 live MCP servers that can't take a task |
| Backup takeover after the main retriever is killed | 7 ms to 2 s |
| Run time | 25 to 45 s |
| Unsupported claims in answers, fixed team vs Sworn (5 questions) | **4 of 38 (11%) vs 0 of 48 (0%)** |

The fixed team has no screening and no checking, and one of its agents invents quotes. Both sides are graded the
same way: a claim used in the answer is unsupported if its quote is not on the page it cites.

Our retrievers pass the benchmark overall, but score 0 on accuracy: on HotpotQA's multi-hop questions, a single
search for the whole question does not surface both gold articles. That is a real weakness the benchmark exposes.

## Layout

| Path | Job |
|---|---|
| `backend/app/orchestrator.py` | LangGraph orchestrator: hire, plan, retrieve, read, reason, verify, generate, replace, record |
| `backend/app/agents.py` | Our agents (7 good, 2 deliberately bad) |
| `backend/app/bench.py`, `bench_build.py` | The standard benchmark (sab-v1): items from public datasets, five equal aspects graded by code |
| `backend/app/registry.py` | Discovery (8004 indexer + SATI), liveness, reputation, feedback |
| `backend/app/main.py` | FastAPI: agent endpoints, run API, kill switch, health, metrics |
| `backend/app/store.py` | Postgres and Redis |
| `backend/app/sources.py`, `rules.py`, `llm.py` | Wikipedia + quote matching, rule-based mode, LLM client |
| `registry/server.js` | Solana bridge: isItAlive, getSummary, giveFeedback, registerAgent |
| `frontend/src/` | Results page: answer, plan, sources, evidence, hiring, validations, inspector, on-chain, registries, baseline, history |
| `mcp/` | Sworn MCP server (stdio) for IDEs and AI hosts |
| `skills/` | Optional host skill packs for research and debug tool use |

The Chrome extension on the poster is optional and not built. Deployment (Vercel, VPS) is not set up; everything runs locally.
