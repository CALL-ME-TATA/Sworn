"""Sworn MCP server (stdio): research presets + evidence/hiring + debug tools."""
from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import client as api

mcp = FastMCP(
    "sworn",
    instructions=(
        "Sworn hires and screens research agents, then answers with verified claims. "
        "Prefer research_brief / research_standard / research_deep for a question, or run_research "
        "when the user specifies length/reasoning. Do not ask clarifying questions on the user's behalf. "
        "Use get_evidence / get_hiring when they want proof or who was hired. Use debug_* for full reports."
    ),
)


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)


@mcp.tool()
async def run_research(
    question: str,
    length: str = "medium",
    reasoning: str = "standard",
    kill: bool = False,
) -> str:
    """Run verified multi-agent research. Blocks until the answer is ready.

    Args:
        question: Research question (as the user asked it).
        length: Answer length: short | medium | long (default medium).
        reasoning: Research depth: light | standard | high (default standard).
        kill: Demo only — kill the main retriever mid-run to force failover.
    """
    if length not in ("short", "medium", "long"):
        length = "medium"
    if reasoning not in ("light", "standard", "high"):
        reasoning = "standard"
    try:
        return _dump(await api.research(question.strip()[:300], length=length, reasoning=reasoning, kill=kill))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def research_brief(question: str) -> str:
    """Fast verified research: short answer, light reasoning (2 sub-questions)."""
    return await run_research(question, length="short", reasoning="light")


@mcp.tool()
async def research_standard(question: str) -> str:
    """Balanced verified research: medium answer, standard reasoning (default)."""
    return await run_research(question, length="medium", reasoning="standard")


@mcp.tool()
async def research_deep(question: str) -> str:
    """Thorough verified research: long answer, high reasoning depth."""
    return await run_research(question, length="long", reasoning="high")


@mcp.tool()
async def get_evidence(run_id: str | None = None) -> str:
    """Claims with quotes, sources, and verifier status for a run (default: latest)."""
    try:
        report = await api.get_run(run_id)
        return _dump(api.evidence_view(report))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def get_hiring(run_id: str | None = None) -> str:
    """Hiring/screening table and failovers for a run (default: latest)."""
    try:
        report = await api.get_run(run_id)
        return _dump(api.hiring_view(report))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_run(run_id: str | None = None) -> str:
    """Full run report JSON (default: latest)."""
    try:
        return _dump(await api.get_run(run_id))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_validations(run_id: str) -> str:
    """Postgres validation records for each claim in the run."""
    try:
        return _dump(await api.validations(run_id))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_get_timing(run_id: str | None = None) -> str:
    """Per-step timings and every agent call for a run."""
    try:
        report = await api.get_run(run_id)
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
    """Latest sab-v1 benchmark scores for screened agents."""
    try:
        return _dump(await api.benchmarks())
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_compare() -> str:
    """Fixed-team baseline vs Sworn unsupported-claim comparison."""
    try:
        return _dump(await api.compare())
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_kill_agent(name: str) -> str:
    """Demo: take an agent offline (localhost only; no auth)."""
    try:
        return _dump(await api.admin("kill", name))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


@mcp.tool()
async def debug_revive_agent(name: str) -> str:
    """Demo: bring a killed agent back online."""
    try:
        return _dump(await api.admin("revive", name))
    except api.SwornError as err:
        return _dump({"error": str(err), "status": err.status})


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


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
