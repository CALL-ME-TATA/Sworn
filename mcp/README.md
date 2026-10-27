# Sworn MCP

Local stdio MCP server that talks to a running Sworn backend (`SWORN_API_URL`, default `http://localhost:3001`).

## Flow

1. **`sworn_init`** — open the MCP session: health + product description + full command catalog with **defaults** and **call examples** (call once first; surface the `guide` field; stop if the user only asked to init)
2. **Later turn:** `research_brief` / `research_standard` / `research_deep` (or `run_research`) — same MCP process reuses the session; returns **plain text**, not JSON
3. **`get_evidence` / `get_hiring`** — inspect the run
4. **`debug_get_run`** — full JSON report (**only when the user asks for a report**)
5. **other `debug_*`** / **`sworn_status`** — engineering dumps / session check

Defaults: unspecified research → `research_standard`; `run_research` → `length=medium`, `reasoning=standard`.

Other tools return `not_initialized` (with the same catalog) until `sworn_init` succeeds. Do not shell-wrap init + research — that loses the in-process session.

## Install

```bash
cd mcp && pip install -e .
```

## Run (stdio)

```bash
# Backend must already be up (docker compose up)
sworn-mcp
# or: python -m sworn_mcp
```

Hosts (Cursor / Claude Desktop) launch this via MCP config — do not expect terminal output; stdio waits for the client.

## Cursor (`.cursor/mcp.json`)

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

In Agent chat: first “sworn init” (see the catalog), then in a follow-up message “research_brief: …”

See the repo root README for Claude Desktop snippets and skill packs under `skills/`.
