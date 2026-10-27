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
from .guardrails import request_hook

# Wikimedia asks API clients to name a contact (email or URL) in the User-Agent.
UA = {"User-Agent": f"sworn-agent-hiring/0.2 (VVCE Hack Day demo; {CONFIG.WIKI_CONTACT})"}
REST = "https://en.wikipedia.org"
CACHE_TTL = 30 * 24 * 3600

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        # Source URLs can come from strangers' agents: every request, each redirect included, must go to a public
        # address (app/guardrails.py), so a source can never reach our database, cache or internal services.
        _client = httpx.AsyncClient(headers=UA, timeout=8.0, follow_redirects=True, event_hooks={"request": [request_hook]})
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
        try:
            res = await client().get(url)
        except httpx.TransportError:  # a slow or dropped connection: try again before failing the agent's task
            if attempt == 4:
                raise
            await asyncio.sleep(attempt)
            continue
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
    if "/wiki/" in url:
        return unquote(url.split("/wiki/")[1]).replace("_", " ")
    return re.sub(r"^www\.", "", httpx.URL(url).host) if url.startswith("http") else ""


# ---------- web search (Tavily) ----------
# Wikipedia has no prices, release schedules or very recent events; the web does.
# The page text Tavily returns is cached under the URL, so the reader and the verifier see exactly the same text.
WEB_TTL = 7 * 24 * 3600


def clean_web_text(text: str) -> str:
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # markdown links and images -> their text
    text = re.sub(r"[ \t]+", " ", text)
    return "\n".join(line.strip(" #*>-|") for line in text.splitlines() if line.strip())


async def search_web(query: str, limit: int = 3) -> list[dict]:
    """[{title, url}] from Tavily, skipping Wikipedia (already covered) and pages without text. [] when off or failing."""
    if not CONFIG.WEB or not query:
        return []
    key = f"web-search:{limit}:{query}"
    hit = await _cached(key)
    if hit is not None:
        return hit
    try:
        res = await client().post("https://api.tavily.com/search", timeout=25, headers={"Authorization": f"Bearer {CONFIG.TAVILY_API_KEY}"},
                                  json={"query": query, "max_results": limit + 2, "search_depth": "basic", "include_raw_content": "text"})
        res.raise_for_status()
        results = res.json().get("results", [])
    except Exception as err:  # noqa: BLE001 - web search is extra coverage; Wikipedia still works without it
        print(f"web search failed: {err}")
        return []
    out = []
    for x in results:
        text = clean_web_text(x.get("raw_content") or x.get("content") or "")
        if "wikipedia.org" in x.get("url", "") or len(text) < 200:
            continue
        await store.redis.set(f"web:{x['url']}", json.dumps(text[:60000]), ex=WEB_TTL)
        out.append({"title": x.get("title") or title_of(x["url"]), "url": x["url"]})
    out = out[:limit]
    await store.redis.set(f"wiki:{key}", json.dumps(out), ex=24 * 3600)  # results go stale faster than pages
    return out


async def source_text(url: str) -> str:
    """Plain text of any source URL; Wikipedia pages go through the API and web pages come from the text the search
    returned, so quotes match the text agents saw."""
    m = re.match(r"^https://en\.wikipedia\.org/wiki/([^#?]+)", url)
    if m:
        return await wiki_text(unquote(m.group(1)).replace("_", " "))
    cached = await store.redis.get(f"web:{url}")
    if cached:
        return json.loads(cached)
    res = await client().get(url)
    res.raise_for_status()
    return html_to_text(res.text) or re.sub(r"<[^>]+>", " ", res.text)


def normalize(s) -> str:
    s = str(s).lower()
    s = re.sub("[‘’]", "'", s)
    s = re.sub("[“”]", '"', s)
    s = re.sub("[–—]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def quote_in(text: str, quote) -> bool:
    """A quote counts only if it is at least 10 characters and appears in the source text."""
    return isinstance(quote, str) and len(normalize(quote)) >= 10 and normalize(quote) in normalize(text)
