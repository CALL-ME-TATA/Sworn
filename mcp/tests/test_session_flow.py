"""Session gate: research tools refuse until sworn_init (mocked health)."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

from sworn_mcp import session as sess
from sworn_mcp.server import research_brief, sworn_init, sworn_status


def setup_function():
    sess.SESSION.ready = False
    sess.SESSION.health = {}
    sess.SESSION.inited_at = None
    sess.SESSION.last_run_id = None


def teardown_function():
    sess.SESSION.ready = False


def test_research_before_init_lists_commands():
    raw = asyncio.run(research_brief("What is penicillin?"))
    data = json.loads(raw)
    assert data["ok"] is False
    assert data["error"] == "not_initialized"
    assert "research_brief" in str(data["commands"])
    assert "sworn_init" in str(data["commands"])
    assert "description" in data


def test_init_then_status():
    with patch("sworn_mcp.server.api.health", new_callable=AsyncMock) as health, \
         patch("sworn_mcp.server.api.run_status", new_callable=AsyncMock) as running:
        health.return_value = {"ok": True, "postgres": "ok", "redis": "ok"}
        running.return_value = {"running": False}
        data = json.loads(asyncio.run(sworn_init()))
    assert data["ok"] is True
    assert data["commands"]["research"]
    assert data["commands"]["session"]
    assert data["commands"]["inspect"]
    assert data["commands"]["debug"]
    assert data["commands"]["session"][0]["name"] == "sworn_init"
    assert "Sworn" in data["description"]
    assert "research_standard" in data["guide"]
    assert data["defaults"]["run_research"]["length"] == "medium"
    assert any("research_brief" in e["call"] for e in data["examples"])
    assert data["commands"]["research"][0]["example"]
    assert "present_to_user" in data
    assert "session" in data
    assert sess.SESSION.ready is True

    with patch("sworn_mcp.server.api.health", new_callable=AsyncMock) as health, \
         patch("sworn_mcp.server.api.run_status", new_callable=AsyncMock) as running:
        health.return_value = {"ok": True, "postgres": "ok", "redis": "ok"}
        running.return_value = {"running": False}
        st = json.loads(asyncio.run(sworn_status()))
    assert st["session_ready"] is True
