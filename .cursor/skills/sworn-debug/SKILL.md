---
name: sworn-debug
description: Inspect Sworn runs — hiring failures, unsupported claims, timing, failover, and kill/revive demos via MCP debug tools.
---

# Sworn debug

1. Call **`sworn_init`** (or `sworn_status`) first if the session is new — MCP tool, not shell. Present the returned `guide` / command catalog (including debug tools and examples). Later turns reuse the same session.
2. Then use debug / inspect tools.

## Tools

| Need | Tool |
|------|------|
| Full report JSON (only when user asks for a report) | `debug_get_run(run_id?)` |
| Claim verdicts | `debug_get_validations(run_id)` |
| Timings + calls | `debug_get_timing(run_id?)` |
| sab-v1 scores | `debug_get_benchmarks()` |
| Baseline compare | `debug_compare()` |
| Failover demo | `debug_kill_agent` / `debug_revive_agent` |

Default run is the last one from this MCP session when `run_id` is omitted.

## Safety

Kill/revive hit an unauthenticated admin API — localhost demo only.
