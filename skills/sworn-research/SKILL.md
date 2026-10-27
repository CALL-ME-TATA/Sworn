---
name: sworn-research
description: Use Sworn MCP for verified multi-agent research with cited claims. Prefer when the user wants trustworthy answers, sources, or hired-agent transparency.
---

# Sworn research

## Session flow (required)

Sessions exist so the user **sees the command catalog before** picking a research tool.

1. Call MCP tool **`sworn_init`** once (never via shell).
2. **Present the catalog** (`guide` / `commands` / `examples` / `defaults`) so the user knows named commands exist.
3. If the user only asked to init — **stop**. Wait for their next message.
4. On a **later turn** (or same turn only if they already asked a research question), call `research_brief` / `research_standard` / `research_deep` / `run_research` as its **own MCP tool call**.
5. Optionally `get_evidence` / `get_hiring` with the `run_id`.

The MCP server process keeps `SESSION.ready` and `last_run_id`. Do **not** re-init unless you get `not_initialized`. Do **not** wrap `sworn_init` + research in one Python/shell process — that kills the session.

Do **not** ask clarifying questions on the user's behalf. Run the question as given.

## Prenamed tools (after sworn_init)

| Intent | Tool | Defaults |
|--------|------|----------|
| Quick / short | `research_brief(question)` | length=short, reasoning=light |
| Default / balanced | `research_standard(question)` | length=medium, reasoning=standard |
| Thorough / long | `research_deep(question)` | length=long, reasoning=high |
| User named length or reasoning | `run_research(question, length?, reasoning?)` | length=medium, reasoning=standard |

### Call examples

```
sworn_init()
research_brief(question="When was penicillin discovered?")
research_standard(question="How does penicillin kill bacteria?")
research_deep(question="Compare β-lactam antibiotics and resistance")
run_research(question="What caused Chernobyl?", length="long", reasoning="high")
get_evidence()   # or get_evidence(run_id="…")
get_hiring()
```

Research tools **block until finished** and return **plain text** (answer + short footer). Show that prose to the user once — do not paste or re-emit JSON.

## After a run

- Proof / quotes → `get_evidence(run_id)`
- Who was hired → `get_hiring(run_id)`
- Full JSON report → `debug_get_run(run_id)` **only if the user asks for a report / JSON**
- Web debugger: `http://localhost:3000/app`

## Do not

- Skip `sworn_init` (other tools return `not_initialized` + the command list)
- Shell-wrap `sworn_init` + research in one process
- Auto-run research right after init when the user only said “init”
- Summarize init as only “connected + three research tools” — surface the full catalog
- Dump research results as JSON in chat (use `debug_get_run` only on request)
- Call a clarify tool (there isn't one on MCP)
