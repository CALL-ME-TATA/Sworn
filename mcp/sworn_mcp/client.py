"""Thin HTTP client over the Sworn FastAPI backend."""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

API = os.getenv("SWORN_API_URL", "http://localhost:3001").rstrip("/")
POLL_S = float(os.getenv("SWORN_POLL_S", "1.2"))
TIMEOUT_S = float(os.getenv("SWORN_RUN_TIMEOUT_S", "600"))


class SwornError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


async def _request(method: str, path: str, **kw) -> Any:
    timeout = kw.pop("timeout", 60.0)
    async with httpx.AsyncClient(base_url=API, timeout=timeout) as client:
        res = await client.request(method, path, **kw)
        if res.status_code >= 400:
            try:
                detail = res.json().get("detail") or res.text
            except Exception:  # noqa: BLE001
                detail = res.text
            raise SwornError(f"{method} {path}: {detail}", res.status_code)
        if res.status_code == 204 or not res.content:
            return None
        return res.json()


async def start_run(question: str, *, length: str = "medium", reasoning: str = "standard", kill: bool = False) -> str:
    data = await _request(
        "POST",
        "/api/run",
        json={"question": question, "length": length, "reasoning": reasoning, "kill": kill, "source": "mcp"},
        timeout=30.0,
    )
    run_id = data.get("run_id")
    if not run_id:
        raise SwornError("backend did not return run_id")
    return run_id


async def get_run(run_id: str | None = None) -> dict:
    if run_id:
        return await _request("GET", f"/api/runs/{run_id}")
    return await _request("GET", "/api/runs/latest")


async def wait_for_run(run_id: str) -> dict:
    """Poll until the run has finished_at (or TIMEOUT_S)."""
    deadline = time.monotonic() + TIMEOUT_S
    last: dict | None = None
    while time.monotonic() < deadline:
        try:
            last = await get_run(run_id)
        except SwornError as err:
            if err.status == 404:
                await asyncio.sleep(POLL_S)
                continue
            raise
        if last.get("finished_at"):
            return last
        await asyncio.sleep(POLL_S)
    raise SwornError(f"run {run_id} did not finish within {TIMEOUT_S:.0f}s")


async def research(question: str, *, length: str = "medium", reasoning: str = "standard", kill: bool = False) -> dict:
    run_id = await start_run(question, length=length, reasoning=reasoning, kill=kill)
    report = await wait_for_run(run_id)
    return summarize_answer(report)


def summarize_answer(report: dict) -> dict:
    metrics = report.get("metrics") or {}
    claims = report.get("claims") or []
    supported = metrics.get("claims_supported")
    if supported is None:
        supported = sum(1 for c in claims if c.get("status") == "supported")
    return {
        "run_id": report.get("run_id"),
        "question": report.get("question"),
        "answer": report.get("answer"),
        "error": report.get("error"),
        "length": report.get("length"),
        "reasoning": report.get("reasoning"),
        "source": report.get("source"),
        "metrics": metrics,
        "round_trip_ms": report.get("round_trip_ms"),
        "claims": len(claims),
        "claims_supported": supported,
        "failovers": len(report.get("failovers") or []),
        "ui": "http://localhost:3000/app#answer",
        "report_url": f"{API}/api/runs/{report.get('run_id')}",
    }


def format_research_text(summary: dict) -> str:
    """Human-readable research result for the agent to show the user (not JSON).

    Full machine-readable report stays on debug_get_run — only when the user asks.
    """
    run_id = summary.get("run_id") or "?"
    if summary.get("error") and not summary.get("answer"):
        return (
            f"Sworn research failed for run `{run_id}`.\n\n"
            f"{summary['error']}\n\n"
            f"Full JSON report (only if requested): debug_get_run(run_id=\"{run_id}\")"
        )

    answer = (summary.get("answer") or "").strip() or "(no answer)"
    claims = summary.get("claims") or 0
    supported = summary.get("claims_supported")
    if supported is None:
        claim_line = f"{claims} claims"
    else:
        claim_line = f"{supported}/{claims} claims supported"

    bits = [claim_line]
    if summary.get("length"):
        bits.append(f"length={summary['length']}")
    if summary.get("reasoning"):
        bits.append(f"reasoning={summary['reasoning']}")
    if summary.get("round_trip_ms") is not None:
        bits.append(f"{summary['round_trip_ms']} ms")
    if summary.get("failovers"):
        bits.append(f"{summary['failovers']} failover(s)")

    # Answer only + a thin footer. No "present as prose" / agent meta — that makes hosts
    # rewrite the answer a second time in the chat while the tool UI already shows it.
    return (
        f"{answer}\n\n"
        f"—\n"
        f"`{run_id}` · {' · '.join(bits)} · {summary.get('ui') or 'http://localhost:3000/app'}"
    )


def evidence_view(report: dict) -> dict:
    claims = []
    for c in report.get("claims") or []:
        claims.append({
            "id": c.get("id"),
            "sub_question": c.get("sub_question"),
            "text": c.get("text"),
            "quote": c.get("quote"),
            "source_url": c.get("source_url"),
            "status": c.get("status"),
            "produced_by": c.get("produced_by_name") or c.get("produced_by"),
            "verified_by": c.get("verified_by_name") or c.get("verified_by"),
            "reason": c.get("reason"),
        })
    return {"run_id": report.get("run_id"), "question": report.get("question"), "claims": claims}


def hiring_view(report: dict) -> dict:
    rows = []
    for h in report.get("hiring") or []:
        rows.append({
            "name": h.get("name"),
            "role": h.get("role"),
            "ours": h.get("ours"),
            "registry": h.get("registry"),
            "protocol": h.get("protocol"),
            "stage": h.get("stage"),
            "result": h.get("result"),
            "reason": h.get("reason"),
            "score": h.get("score"),
            "bench": (h.get("bench") or {}).get("score") if h.get("bench") else None,
        })
    return {
        "run_id": report.get("run_id"),
        "team": report.get("team") or {},
        "hiring": rows,
        "failovers": report.get("failovers") or [],
        "dead": report.get("dead") or [],
    }


async def validations(run_id: str) -> Any:
    return await _request("GET", f"/api/runs/{run_id}/validations")


async def benchmarks() -> Any:
    return await _request("GET", "/api/benchmarks")


async def compare() -> Any:
    return await _request("GET", "/api/compare")


async def health() -> Any:
    return await _request("GET", "/api/health")


async def run_status() -> Any:
    return await _request("GET", "/api/status")


async def admin(action: str, name: str) -> Any:
    return await _request("POST", f"/admin/{action}/{name}")
