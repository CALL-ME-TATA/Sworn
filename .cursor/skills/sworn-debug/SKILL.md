---
name: sworn-debug
description: Inspect Sworn runs — hiring failures, unsupported claims, timing, failover, and kill/revive demos via MCP debug tools.
---

# Sworn debug

Use when the user is debugging Sworn itself, a failed hire, an unsupported claim, failover, or MCP integration.

## Tools

| Need | Tool |
|------|------|
| Full report JSON | `debug_get_run(run_id?)` |
| Claim verdicts in Postgres | `debug_get_validations(run_id)` |
| Step timings + agent calls | `debug_get_timing(run_id?)` |
| sab-v1 scores | `debug_get_benchmarks()` |
| Fixed team vs Sworn | `debug_compare()` |
| Failover demo | `debug_kill_agent(name)` then research with kill, then `debug_revive_agent(name)` |

Default `run_id` is the latest run when omitted.

## How to read failures

- **Hiring** (`get_hiring` / Hiring tab): reputation / alive / benchmark stage and reason
- **Evidence**: claim `status` `supported` | `unsupported` | `unreachable`
- **Failovers**: listed on hiring view and in `debug_get_timing`
- **Origin**: runs started via MCP have `source: "mcp"` in the report and a badge on `/app`

## Safety

`debug_kill_agent` / `debug_revive_agent` hit an unauthenticated admin API. Localhost demo only.
