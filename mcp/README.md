# Sworn MCP

MCP server for Sworn. Talks to the FastAPI backend (`SWORN_API_URL`).

## Flow

1. **`sworn_init`** — session open: health + product description + command catalog
2. **`research_brief` / `research_standard` / `research_deep`** (or `run_research`) — plain-text answer
3. **`get_evidence` / `get_hiring`** — inspect
4. **`debug_*`** — engineering dumps (JSON only when asked)

## Docker (recommended)

With the stack:

```bash
docker compose up --build
```

MCP listens at **http://localhost:3003/mcp** (streamable HTTP).

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "sworn": {
      "url": "http://localhost:3003/mcp"
    }
  }
}
```

### Claude Desktop / stdio via Docker

If the host only supports stdio:

```json
{
  "mcpServers": {
    "sworn": {
      "command": "docker",
      "args": [
        "compose", "-f", "D:/Hackathon/vvce-hackathon/docker-compose.yml",
        "run", "--rm", "-T",
        "-e", "MCP_TRANSPORT=stdio",
        "mcp"
      ]
    }
  }
}
```

(Adjust the compose file path for your machine.)

## Local install (no Docker)

```bash
cd mcp && pip install -e .
set SWORN_API_URL=http://localhost:3001
sworn-mcp
```

Env:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SWORN_API_URL` | `http://localhost:3001` | Backend API |
| `MCP_TRANSPORT` | `stdio` | `stdio` \| `sse` \| `streamable-http` |
| `MCP_HOST` | `127.0.0.1` | HTTP bind (use `0.0.0.0` in Docker) |
| `MCP_PORT` | `3003` | HTTP port |

See repo root README for skill packs under `skills/`.
