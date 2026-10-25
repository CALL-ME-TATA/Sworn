"""One function: ask(prompt, json=...) -> model reply. Used by our agents.
LLM_PROVIDER picks the OpenAI-compatible endpoint: groq (default), openai or gemini."""
import json
import os

from openai import AsyncOpenAI

from .config import CONFIG

ENDPOINTS = {
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY"),
    "openai": (None, "OPENAI_API_KEY"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY"),
}

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        base_url, key_env = ENDPOINTS[CONFIG.PROVIDER]
        # The SDK retries 429s and 5xx with backoff and honours retry-after, so a busy minute is not a broken agent.
        _client = AsyncOpenAI(base_url=base_url, api_key=os.getenv(key_env, "missing"), max_retries=2, timeout=60)
    return _client


async def ask(prompt: str, *, json_mode: bool = False, system: str | None = None):
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    for attempt in (1, 2):
        res = await client().chat.completions.create(
            model=CONFIG.MODEL,
            messages=messages,
            temperature=0.2,
            max_completion_tokens=4096,
            **({"response_format": {"type": "json_object"}} if json_mode else {}),
        )
        text = res.choices[0].message.content or ""
        if not json_mode:
            return text
        try:
            return parse_json(text)
        except ValueError as err:
            if attempt == 2:
                raise ValueError(f"model did not return JSON: {err}") from err


def parse_json(text: str):
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    end = max(text.rfind("}"), text.rfind("]"))
    if not starts or end < 0:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[min(starts):end + 1])
