# Sworn MCP

Local stdio MCP server that talks to a running Sworn backend (`SWORN_API_URL`, default `http://localhost:3001`).

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

## Cursor (`mcp.json`)

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

See the repo root README for Claude Desktop / VS Code snippets and skill packs under `skills/`.
