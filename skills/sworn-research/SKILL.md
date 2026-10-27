---
name: sworn-research
description: Use Sworn MCP for verified multi-agent research with cited claims. Prefer when the user wants trustworthy answers, sources, or hired-agent transparency.
---

# Sworn research

Sworn hires agents from open Solana registries, screens them, verifies every claim against its source, and returns a cited answer.

## When to use

- The user wants a researched answer with evidence, not a model guess
- They ask who was hired, what was screened, or whether claims are supported
- They mention brief / deep / thorough / quick research

## How to call

Do **not** ask clarifying questions on the user's behalf. Run the question as given.

| Intent | Tool |
|--------|------|
| Quick / short | `research_brief(question)` |
| Default / balanced | `research_standard(question)` |
| Thorough / long | `research_deep(question)` |
| User named length or reasoning | `run_research(question, length?, reasoning?)` |

Defaults for `run_research`: `length=medium`, `reasoning=standard`. Allowed: length `short|medium|long`, reasoning `light|standard|high`.

Research tools **block until finished** and return `answer`, `run_id`, and metrics. Surface the answer and cite `run_id`.

## After a run

- User wants proof / quotes / sources → `get_evidence(run_id)`
- User asks who was hired or why someone failed → `get_hiring(run_id)`
- Point them at the web debugger: `http://localhost:3000/app` (same run)

## Do not

- Call a clarify tool (there isn't one on MCP)
- Re-run research just to fetch the same answer; use `debug_get_run` if needed
