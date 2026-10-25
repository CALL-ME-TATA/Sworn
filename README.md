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
2. **Screen every candidate.** On-chain reputation, then liveness, then a known-answer trial graded by code.
   Fail any one and it is out.
3. **Planner agent** splits the question into sub-questions, each with a focused search.
4. **Hired team.**
   - The retriever fetches sources.
   - The reader extracts facts.
   - The reasoner states claims.
   - A verifier that is not the producer re-reads each quote on its source page.
   - The generator answers from verified claims only.
5. **Replace agent.** A timeout or crash marks the agent dead, and a screened backup takes over.
6. **Final answer** with sources and agent IDs on every claim.
7. **Write performance back** to the registry, one feedback transaction per agent, each linking the run
   report.

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

On "validation records": the 8004 SDK's validation registry is archived (its calls throw). Verifier verdicts
are stored as validation records in Postgres (`/api/runs/{id}/validations`). On-chain, each agent's feedback
carries its outcome and links the full run report.

## Run it

```bash
cp .env.example .env            # add GROQ_API_KEY and WIKI_CONTACT
cd registry && npm install && npm run keygen && cd ..   # two devnet wallets in .env; fund both from Phantom
docker compose up --build       # frontend :3000, backend :3001, registry bridge :3002, Postgres, Redis, Prometheus
docker compose exec backend python -m app.register      # put our 9 agents on devnet (once)
```

Open http://localhost:3000 and ask a question. Tick "Kill main retriever" to watch failover.

From the command line:

```bash
docker compose exec backend python -m app.orchestrator "How was penicillin discovered?" --kill --no-feedback
docker compose exec backend python -m app.baseline      # fixed team vs ours on data/questions.json
docker compose exec backend python -m pytest -q
docker compose run --rm registry npm run sati-sync       # refresh SATI agents from the chain
```

## Results (devnet, Groq)

| Measure | Result |
|---|---|
| Claims tagged with source and agent IDs | 100% |
| Deliberately bad agents rejected | 2 of 2 (now by their on-chain reputation, before any trial) |
| Third-party registry agents that passed | 0 of 6 (3 low reputation, 3 not responding) |
| Backup takeover after the main retriever is killed | 1.8 s |
| Run time, two-part question | 25 to 40 s |
| Unsupported claims in answers, fixed team vs ours | 17% vs 0% (measured with the earlier Node version; rerun `app.baseline` to refresh) |

## Layout

| Path | Job |
|---|---|
| `backend/app/orchestrator.py` | LangGraph orchestrator: hire, plan, retrieve, read, reason, verify, generate, replace, record |
| `backend/app/agents.py` | Our agents (7 good, 2 deliberately bad) |
| `backend/app/trials.py` | Known-answer trials per role and their graders |
| `backend/app/registry.py` | Discovery (8004 indexer + SATI), liveness, reputation, feedback |
| `backend/app/main.py` | FastAPI: agent endpoints, run API, kill switch, health, metrics |
| `backend/app/store.py` | Postgres and Redis |
| `backend/app/sources.py`, `rules.py`, `llm.py` | Wikipedia + quote matching, rule-based mode, LLM client |
| `registry/server.js` | Solana bridge: isItAlive, getSummary, giveFeedback, registerAgent |
| `frontend/src/` | Results page: answer, evidence, hiring bracket, on-chain record, registries, baseline, history |

The Chrome extension on the poster is optional and not built. Deployment (Vercel, VPS) is not set up; everything runs locally.
