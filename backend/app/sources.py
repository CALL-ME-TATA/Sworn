"""Wikipedia search and page text, plus the quote check used by agents, trials and the baseline."""
import asyncio
import html as htmlmod
import json
import re
import time
from urllib.parse import quote as urlquote, unquote

import httpx

from . import store
from .config import CONFIG, DATA

# Wikimedia asks API clients to name a contact (email or URL) in the User-Agent.
UA = {"User-Agent": f"sworn-agent-hiring/0.2 (VVCE Hack Day demo; {CONFIG.WIKI_CONTACT})"}
REST = "https://en.wikipedia.org"
CACHE_TTL = 30 * 24 * 3600

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(headers=UA, timeout=8.0, follow_redirects=True)
    return _client


async def seed_cache():
    """Load the old on-disk Wikipedia cache into Redis once, so trials don't refetch pages we already have."""
    path = DATA / "wiki-cache.json"
    if not path.exists() or await store.redis.exists("wiki:seeded"):
        return
    cache = json.loads(path.read_text(encoding="utf-8"))
    async with store.redis.pipeline(transaction=False) as p:
        for key, value in cache.items():
            p.set(f"wiki:{key}", json.dumps(value), ex=CACHE_TTL)
        p.set("wiki:seeded", "1")
        await p.execute()


async def _cached(key: str):
    v = await store.redis.get(f"wiki:{key}")
    return None if v is None else json.loads(v)


async def _remember(key: str, value):
    await store.redis.set(f"wiki:{key}", json.dumps(value), ex=CACHE_TTL)
    return value


def wiki_url(title: str) -> str:
    return f"https://en.wikipedia.org/wiki/{urlquote(title.replace(' ', '_'), safe='')}"


# At most one Wikipedia request per 200 ms from this process, as Wikimedia's API etiquette asks for.
_pace = asyncio.Lock()
_next_slot = 0.0


async def _paced():
    global _next_slot
    async with _pace:
        wait = _next_slot - time.monotonic()
        _next_slot = max(_next_slot, time.monotonic()) + 0.2
    if wait > 0:
        await asyncio.sleep(wait)


async def _get(url: str) -> httpx.Response:
    for attempt in range(1, 5):
        await _paced()
        res = await client().get(url)
        if res.status_code == 429 and attempt < 4:
            wait = float(res.headers.get("retry-after") or 0) or 2 ** attempt
            await asyncio.sleep(min(wait, 10))
            continue
        res.raise_for_status()
        return res
    raise RuntimeError("unreachable")


# REST endpoints (CDN-cached) instead of action=query&prop=extracts, which Wikimedia throttles hard.
async def search_wikipedia(query: str, limit: int = 2) -> list[str]:
    key = f"search:{limit}:{query}"
    hit = await _cached(key)
    if hit is not None:
        return hit
    j = (await _get(f"{REST}/w/rest.php/v1/search/page?limit={limit}&q={urlquote(query)}")).json()
    return await _remember(key, [p["title"] for p in j["pages"]])


async def wiki_text(title: str) -> str:
    key = f"html:{title}"
    hit = await _cached(key)
    if hit is not None:
        return hit
    res = await _get(f"{REST}/api/rest_v1/page/html/{urlquote(title.replace(' ', '_'), safe='')}")
    return await _remember(key, html_to_text(res.text))


TAG = re.compile(r"""<(?:[^>"']|"[^"]*"|'[^']*')*>""")  # attribute values can contain '>' (Parsoid's data-mw JSON)
REF = re.compile(r"""<sup(?:[^>"']|"[^"]*"|'[^']*')*class="[^"]*reference[\s\S]*?</sup>""", re.I)


def html_to_text(html: str) -> str:
    """Article prose only: the text of <p> elements, so infoboxes, captions and navboxes never become "facts"."""
    out = []
    for p in re.findall(r"<p[\s>][\s\S]*?</p>", html, re.I):
        p = REF.sub("", p)
        p = re.sub(r"<style[\s\S]*?</style>", "", p, flags=re.I)
        p = htmlmod.unescape(TAG.sub("", p)).replace("\xa0", " ")
        p = re.sub(r"\s+", " ", p).strip()
        if p:
            out.append(p)
    return "\n".join(out)


def title_of(url: str) -> str:
    return unquote(url.split("/wiki/")[1] if "/wiki/" in url else "").replace("_", " ")


async def source_text(url: str) -> str:
    """Plain text of any source URL; Wikipedia pages go through the API so quotes match the text agents saw."""
    m = re.match(r"^https://en\.wikipedia\.org/wiki/([^#?]+)", url)
    if m:
        return await wiki_text(unquote(m.group(1)).replace("_", " "))
    res = await client().get(url)
    res.raise_for_status()
    return re.sub(r"<[^>]+>", " ", res.text)


def normalize(s) -> str:
    s = str(s).lower()
    s = re.sub("[‘’]", "'", s)
    s = re.sub("[“”]", '"', s)
    s = re.sub("[–—]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def quote_in(text: str, quote) -> bool:
    """A quote counts only if it is at least 10 characters and appears in the source text."""
    return isinstance(quote, str) and len(normalize(quote)) >= 10 and normalize(quote) in normalize(text)
