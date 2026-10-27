"""A daily limit on one model must move to the next model; when all are out, ask() raises ProviderLimit."""
import asyncio

import httpx
import pytest
from openai import RateLimitError

from app import llm


def limit(model, per="tokens per day (TPD)", wait="6m44.5s"):
    res = httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions"))
    return RateLimitError(f"Rate limit reached for model `{model}` on {per}. Please try again in {wait}.", response=res, body=None)


def test_parses_groq_wait():
    assert llm._wait_seconds("Please try again in 6m44.784s.") == pytest.approx(404.784)
    assert llm._wait_seconds("Please try again in 1h2m3s") == 3723


def test_daily_limit_falls_back_then_gives_up(monkeypatch):
    monkeypatch.setattr(llm.CONFIG, "PROVIDER", "groq")
    monkeypatch.setattr(llm.CONFIG, "MODEL", "openai/gpt-oss-120b")
    llm._exhausted.clear()
    tried = []

    async def fake(model, messages, json_mode, effort):
        tried.append(model)
        if model == "openai/gpt-oss-120b":
            raise limit(model)
        return '{"ok": true}'

    monkeypatch.setattr(llm, "_complete", fake)
    assert asyncio.run(llm.ask("hi", json_mode=True)) == {"ok": True}
    assert tried == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    assert llm.model_in_use() == "openai/gpt-oss-20b"

    async def all_out(model, messages, json_mode, effort):
        raise limit(model)

    monkeypatch.setattr(llm, "_complete", all_out)
    with pytest.raises(llm.ProviderLimit):
        asyncio.run(llm.ask("hi"))
    llm._exhausted.clear()


def test_per_minute_limit_on_every_model_is_busy(monkeypatch):
    monkeypatch.setattr(llm.CONFIG, "PROVIDER", "groq")
    llm._exhausted.clear()

    async def per_minute(model, messages, json_mode, effort):
        raise limit(model, per="tokens per minute (TPM)", wait="4.2s")

    monkeypatch.setattr(llm, "_complete", per_minute)
    with pytest.raises(llm.ProviderLimit) as err:
        asyncio.run(llm.ask("hi"))
    assert 0 < err.value.retry_after <= 4.2  # each model rests only until its per-minute limit resets
    assert set(llm._exhausted) == set(llm.models())
    llm._exhausted.clear()


def test_tool_call_quirk_moves_to_the_next_model(monkeypatch):
    from openai import BadRequestError
    monkeypatch.setattr(llm.CONFIG, "PROVIDER", "groq")
    monkeypatch.setattr(llm.CONFIG, "MODEL", "openai/gpt-oss-120b")
    llm._exhausted.clear()
    tried = []

    async def fake(model, messages, json_mode, effort):
        tried.append(model)
        if model == "openai/gpt-oss-120b":
            res = httpx.Response(400, request=httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions"))
            raise BadRequestError("Tool choice is none, but model called a tool (tool_use_failed)", response=res, body=None)
        return '{"ok": true}'

    monkeypatch.setattr(llm, "_complete", fake)
    assert asyncio.run(llm.ask("hi", json_mode=True)) == {"ok": True}
    assert tried == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
