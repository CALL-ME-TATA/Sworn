"""Sworn MCP server (stdio): init → prenamed research tools → inspect / debug."""
from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import client as api
from . import __version__
from .session import SESSION, catalog_payload, not_ready_payload

mcp = FastMCP(
    "sworn",
    instructions=(
        "ALWAYS call sworn_init first in a new conversation before any other Sworn tool. "
        "sworn_init opens the MCP session, checks health, and returns the product description "
        "plus the full command catalog (names, defaults, examples). "
        "After sworn_init succeeds, later turns in the SAME chat call research_brief / "
        "research_standard / research_deep (or run_research) as SEPARATE MCP tool calls — "
        "do not re-init, and do not shell-wrap init+research in one process. "
        "The in-process session remembers ready state and last run_id until the MCP server restarts. "
        "Research tools return plain text (the answer + a short footer) — show that prose to the user. "
        "Do NOT paste JSON into the chat. Call debug_get_run only when the user asks for a report/JSON. "
        "Do not ask clarifying questions on the user's behalf. "
        "After a run, use get_evidence / get_hiring when the user wants proof or who was hired. "
        "Use other debug_* tools only for engineering inspection."
    ),
)


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)


def _gate() -> str | None:
    """Return an error payload if init has not succeeded yet."""
    if SESSION.ready:
        return None
    return _dump(not_ready_payload())


def _track(payload: dict) -> dict:
    SESSION.remember_run(payload.get("run_id"))
    return payload


# ---------- session ----------

@mcp.tool()
async def sworn_init() -> str:
    """Open a Sworn MCP session. Call this once first (before research/debug).

    Checks the backend is reachable, then returns what Sworn does, every available
    command name (session / research / inspect / debug), defaults, and call examples.
    Later turns reuse this same MCP process session — call research_* separately;
    do not re-run sworn_init unless you get not_initialized.
    """
    try:
        health = await api.health()
    except api.SwornError as err:
        SESSION.ready = False
        return _dump({
            "ok": False,
            "error": str(err),
            "status": err.status,
            "api_url": api.API,
            "hint": "Start the stack (docker compose up) so the API is on SWORN_API_URL (default http://localhost:3001), then call sworn_init again.",
            **catalog_payload(),
        })
    except Exception as err:  # noqa: BLE001
        SESSION.ready = False
        return _dump({
            "ok": False,
            "error": f"unreachable: {err}",
            "api_url": api.API,
            "hint": "Is the backend running? docker compose up — then call sworn_init again.",
            **catalog_payload(),
        })

    ok = bool(health.get("ok"))
    if not ok:
        SESSION.ready = False
        return _dump({
            "ok": False,
            "error": "backend unhealthy",
            "api_url": api.API,
            "health": health,
            **catalog_payload(),
        })

    try:
        busy = await api.run_status()
    except api.SwornError:
        busy = {"running": None}

    SESSION.mark_ready(api.API, health)
    return _dump({
        "ok": True,
        "version": __version__,
        "api_url": api.API,
        "health": health,
        "running": busy.get("running"),
        "inited_at": SESSION.inited_at,
        **catalog_payload(),
        "next": [
            "Surface the `guide` field to the user (what Sworn does, defaults, examples, all commands).",
            "STOP here if the user only asked to init — let them pick a command from the catalog.",
            "On a later turn, call research_brief / research_standard (default) / research_deep as its own MCP tool call.",
            "Or run_research(question, length?, reasoning?) when the user names those knobs.",
            "Then optionally get_evidence / get_hiring with the returned run_id.",
        ],
        "present_to_user": (
            "After sworn_init succeeds, show the user: (1) what Sworn does from `description`/`guide`, "
            "(2) health + API URL + debugger UI, (3) the full command list with examples and defaults — "
            "do not collapse to only three research tools. Do not auto-run research unless the user already asked a question."
        ),
        "session": (
            "This MCP server process keeps SESSION.ready and last_run_id. "
            "Research tools in later chat turns reuse it — do not shell-wrap sworn_init + research together."
        ),
    })


@mcp.tool()
async def sworn_status() -> str:
    """Session + backend status (call after sworn_init)."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        health = await api.health()
        busy = await api.run_status()
    except api.SwornError as err:
        return _dump({"ok": False, "error": str(err), "status": err.status, "session_ready": SESSION.ready})
    return _dump({
        "ok": True,
        "session_ready": SESSION.ready,
        "api_url": SESSION.api_url or api.API,
        "inited_at": SESSION.inited_at,
        "last_run_id": SESSION.last_run_id,
        "health": health,
        "running": busy.get("running"),
        **catalog_payload(),
    })


# ---------- research ----------

@mcp.tool()
async def run_research(
    question: str,
    length: str = "medium",
    reasoning: str = "standard",
    kill: bool = False,
) -> str:
    """Run verified multi-agent research. Requires sworn_init first. Blocks until the answer is ready.

    Returns plain text (answer + short footer) for the user — not JSON.
    Full JSON report: call debug_get_run only when the user asks for a report.

    Args:
        question: Research question (as the user asked it).
        length: Answer length: short | medium | long (default medium).
        reasoning: Research depth: light | standard | high (default standard).
        kill: Demo only — kill the main retriever mid-run to force failover.
    """
    blocked = _gate()
    if blocked:
        return blocked
    if length not in ("short", "medium", "long"):
        length = "medium"
    if reasoning not in ("light", "standard", "high"):
        reasoning = "standard"
    try:
        out = _track(
            await api.research(question.strip()[:300], length=length, reasoning=reasoning, kill=kill)
        )
        return api.format_research_text(out)
    except api.SwornError as err:
        return f"Sworn research error ({err.status}): {err}"


@mcp.tool()
async def research_brief(question: str) -> str:
    """Prenamed preset: short answer + light reasoning. Returns plain text (not JSON). Requires sworn_init first."""
    return await run_research(question, length="short", reasoning="light")


@mcp.tool()
async def research_standard(question: str) -> str:
    """Prenamed preset: medium answer + standard reasoning. Returns plain text (not JSON). Requires sworn_init first."""
    return await run_research(question, length="medium", reasoning="standard")


@mcp.tool()
async def research_deep(question: str) -> str:
    """Prenamed preset: long answer + high reasoning. Returns plain text (not JSON). Requires sworn_init first."""
    return await run_research(question, length="long", reasoning="high")


# ---------- inspect ----------

async def _resolve_run(run_id: str | None) -> dict:
    rid = run_id or SESSION.last_run_id
    return await api.get_run(rid)


@mcp.tool()
async def get_evidence(run_id: str | None = None) -> str:
    """Claims with quotes, sources, and verifier status. Requires sworn_init. Default: last run from this session."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        report = await _resolve_run(run_id)
        SESSION.remember_run(report.get("run_id"))
        return _dump(api.evidence_view(report))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def get_hiring(run_id: str | None = None) -> str:
    """Hiring/screening table and failovers. Requires sworn_init. Default: last run from this session."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        report = await _resolve_run(run_id)
        SESSION.remember_run(report.get("run_id"))
        return _dump(api.hiring_view(report))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


# ---------- debug ----------

@mcp.tool()
async def debug_get_run(run_id: str | None = None) -> str:
    """Full run report as JSON. Requires sworn_init. Use only when the user asks for a report/JSON dump."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        report = await _resolve_run(run_id)
        SESSION.remember_run(report.get("run_id"))
        return _dump(report)
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_validations(run_id: str) -> str:
    """Postgres validation records for each claim. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        return _dump(await api.validations(run_id))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_timing(run_id: str | None = None) -> str:
    """Per-step timings and every agent call. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        report = await _resolve_run(run_id)
        return _dump({
            "run_id": report.get("run_id"),
            "round_trip_ms": report.get("round_trip_ms"),
            "timings": report.get("timings") or {},
            "calls": report.get("calls") or [],
            "failovers": report.get("failovers") or [],
            "kill": report.get("kill"),
        })
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_benchmarks() -> str:
    """Latest sab-v1 benchmark scores. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        return _dump(await api.benchmarks())
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_compare() -> str:
    """Fixed-team baseline vs Sworn. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        return _dump(await api.compare())
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_kill_agent(name: str) -> str:
    """Demo: take an agent offline. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        return _dump(await api.admin("kill", name))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_revive_agent(name: str) -> str:
    """Demo: bring a killed agent back online. Requires sworn_init."""
    blocked = _gate()
    if blocked:
        return blocked
    try:
        return _dump(await api.admin("revive", name))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


# ---------- resources / prompts ----------

@mcp.resource("sworn://runs/latest")
async def resource_latest() -> str:
    """Latest run report."""
    return _dump(await api.get_run())


@mcp.resource("sworn://runs/{run_id}")
async def resource_run(run_id: str) -> str:
    """One run report by id."""
    return _dump(await api.get_run(run_id))


@mcp.resource("sworn://benchmarks")
async def resource_benchmarks() -> str:
    """Benchmark summary table."""
    return _dump(await api.benchmarks())


@mcp.resource("sworn://health")
async def resource_health() -> str:
    """Backend health (postgres / redis)."""
    return _dump(await api.health())


@mcp.prompt()
def sworn_start() -> str:
    """Begin a Sworn research session: init then pick a preset."""
    return (
        "Call the Sworn MCP tool `sworn_init` first (MCP tool call, not a shell). "
        "Show the user the guide/catalog it returns so they see named commands. "
        "On a later turn — or in this turn only if they already asked a research question — "
        "call research_brief, research_standard, or research_deep as a separate MCP tool call "
        "(or run_research if they specified length/reasoning). Do not shell-wrap sworn_init + research. "
        "Do not ask clarifying questions. "
        "Research tools return plain text — show that answer to the user; do not paste JSON. "
        "Call debug_get_run only if they ask for a report. "
        "Offer get_evidence or get_hiring if they want proof or hiring detail."
    )


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
