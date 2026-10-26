"""One function: ask(prompt, json=...) -> model reply. Used by our agents.
LLM_PROVIDER picks the OpenAI-compatible endpoint: groq (default), openai or gemini."""
import json
import os
import re
import time

import asyncio

from openai import APIConnectionError, AsyncOpenAI, InternalServerError, RateLimitError

from .config import CONFIG

ENDPOINTS = {
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY"),
    "openai": (None, "OPENAI_API_KEY"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY"),
}

# When a model's daily quota runs out, the next one is used. Each Groq model has its own daily limit.
FALLBACKS = {"groq": ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]}


class ProviderLimit(Exception):
    """Our own AI provider is out of quota. Not the agent's fault: agents answer 429, and nobody is scored for it."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


_client: AsyncOpenAI | None = None
_exhausted: dict[str, float] = {}  # model -> monotonic time its daily quota is expected back
USED: set[str] = set()  # models that answered at least once in this process (shown as the run's mode)


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        base_url, key_env = ENDPOINTS[CONFIG.PROVIDER]
        # No hidden SDK retries: a daily-limit 429 must switch model at once, not sit through backoff while a trial times out.
        _client = AsyncOpenAI(base_url=base_url, api_key=os.getenv(key_env, "missing"), max_retries=0, timeout=60)
    return _client


def _wait_seconds(message: str) -> float | None:
    """Groq says 'Please try again in 6m44.784s'."""
    m = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", message)
    return None if not m else int(m[1] or 0) * 3600 + int(m[2] or 0) * 60 + float(m[3])


def models() -> list[str]:
    return [CONFIG.MODEL] + [m for m in FALLBACKS.get(CONFIG.PROVIDER, []) if m != CONFIG.MODEL]


async def _complete(model: str, messages: list[dict], json_mode: bool) -> str:
    """One completion. A short per-minute pause (a few seconds) or a dropped connection is retried here;
    anything longer is raised, so the caller can switch model or report the provider as busy."""
    for attempt in range(1, 4):
        try:
            return await _create(model, messages, json_mode)
        except RateLimitError as err:
            msg, wait = str(err), _wait_seconds(str(err))
            if "per day" in msg or "(TPD)" in msg or "(RPD)" in msg or wait is None or wait > 8 or attempt == 3:
                raise
            await asyncio.sleep(wait + 0.25)
        except (APIConnectionError, InternalServerError):
            if attempt == 3:
                raise
            await asyncio.sleep(attempt)
    raise RuntimeError("unreachable")


async def _create(model: str, messages: list[dict], json_mode: bool) -> str:
    res = await client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        max_completion_tokens=4096,
        **({"response_format": {"type": "json_object"}} if json_mode else {}),
    )
    return res.choices[0].message.content or ""


async def ask(prompt: str, *, json_mode: bool = False, system: str | None = None):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    for model in models():
        if _exhausted.get(model, 0) > time.monotonic():
            continue
        try:
            for attempt in (1, 2):
                text = await _complete(model, messages, json_mode)
                USED.add(model)
                if not json_mode:
                    return text
                try:
                    return parse_json(text)
                except ValueError as err:
                    if attempt == 2:
                        raise ValueError(f"model did not return JSON: {err}") from err
        except RateLimitError as err:
            msg = str(err)
            wait = _wait_seconds(msg)
            if "per day" in msg or "(TPD)" in msg or "(RPD)" in msg:
                _exhausted[model] = time.monotonic() + (wait or 600)
                print(f"{model}: daily limit reached, trying the next model")
                continue
            raise ProviderLimit(f"the AI provider is busy (per-minute limit on {model})", wait) from err
    back = min((t for t in _exhausted.values()), default=None)
    raise ProviderLimit("every AI model we use has reached its daily limit", back and back - time.monotonic())


def parse_json(text: str):
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    end = max(text.rfind("}"), text.rfind("]"))
    if not starts or end < 0:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[min(starts):end + 1])


def model_in_use() -> str:
    """The model calls go to right now (the first one with daily quota left)."""
    return next((m for m in models() if _exhausted.get(m, 0) <= time.monotonic()), CONFIG.MODEL)
