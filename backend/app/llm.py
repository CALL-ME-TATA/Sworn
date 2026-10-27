"""One function: ask(prompt, json=...) -> model reply. Used by our agents.
LLM_PROVIDER picks the OpenAI-compatible endpoint: groq (default), openai or gemini."""
import asyncio
import json
import os
import re
import time

from openai import APIConnectionError, AsyncOpenAI, BadRequestError, InternalServerError, RateLimitError

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


async def _complete(model: str, messages: list[dict], json_mode: bool, effort: str) -> str:
    """One completion. A short per-minute pause (a few seconds) or a dropped connection is retried here;
    anything longer is raised, so the caller can switch model or report the provider as busy."""
    for attempt in range(1, 4):
        try:
            return await _create(model, messages, json_mode, effort)
        except RateLimitError as err:
            msg, wait = str(err), _wait_seconds(str(err))
            if "per day" in msg or "(TPD)" in msg or "(RPD)" in msg or wait is None or wait > 8 or attempt == 3:
                raise
            await asyncio.sleep(wait + 0.25)
        except (APIConnectionError, InternalServerError):
            if attempt == 3:
                raise
            await asyncio.sleep(attempt)
        except BadRequestError as err:
            # gpt-oss sometimes tries to call its built-in browsing tool, which Groq rejects ("tool_use_failed").
            # Ask once more without tools; if it does it again, the caller moves on to the next model.
            if "tool_use_failed" not in str(err) or attempt > 1:
                raise
            messages = [{"role": "system", "content": "You have no tools. Do not call any tool; reply directly."}] +                        [m for m in messages if m["role"] != "system" or "no tools" not in m["content"]]
    raise RuntimeError("unreachable")


async def _create(model: str, messages: list[dict], json_mode: bool, effort: str) -> str:
    res = await client().chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        # Groq counts the reserved output against the per-minute token budget (8,000 on the free tier), so keep it modest;
        # 2,000 still fits low-effort reasoning plus a 300-word answer, 4,000 fits more reasoning plus a 500-word one.
        max_completion_tokens=2000 if effort == "low" else 4000,
        # gpt-oss models reason before answering, inside the same token cap; on a long answer they can spend it all and
        # return nothing. Low effort is the default; the user's "high reasoning" asks for more.
        **({"reasoning_effort": effort} if "gpt-oss" in model else {}),
        **({"response_format": {"type": "json_object"}} if json_mode else {}),
    )
    return res.choices[0].message.content or ""


async def ask(prompt: str, *, json_mode: bool = False, system: str | None = None, effort: str = "low"):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    for model in models():
        if _exhausted.get(model, 0) > time.monotonic():
            continue
        try:
            for attempt in (1, 2):
                text = await _complete(model, messages, json_mode, effort)
                if not text.strip():  # it ran out of tokens before answering: let the next model try
                    print(f"{model}: empty reply, trying the next model")
                    break
                USED.add(model)
                if not json_mode:
                    return text
                try:
                    return parse_json(text)
                except ValueError as err:
                    if attempt == 2:
                        raise ValueError(f"model did not return JSON: {err}") from err
        except BadRequestError as err:
            if "tool_use_failed" not in str(err):
                raise
            print(f"{model}: kept calling a tool, trying the next model")
            continue
        except RateLimitError as err:
            # Each model has its own daily and per-minute budget: rest this one until its limit resets, use the next.
            msg = str(err)
            daily = "per day" in msg or "(TPD)" in msg or "(RPD)" in msg
            wait = _wait_seconds(msg)
            _exhausted[model] = time.monotonic() + (wait or (600 if daily else 20))
            print(f"{model}: {'daily' if daily else 'per-minute'} limit reached, trying the next model")
    back = min((t for t in _exhausted.values()), default=None)
    raise ProviderLimit("every AI model we use is at its rate limit", back and back - time.monotonic())


def parse_json(text: str):
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    end = max(text.rfind("}"), text.rfind("]"))
    if not starts or end < 0:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[min(starts):end + 1])


def model_in_use() -> str:
    """The model calls go to right now (the first one with daily quota left)."""
    return next((m for m in models() if _exhausted.get(m, 0) <= time.monotonic()), CONFIG.MODEL)
