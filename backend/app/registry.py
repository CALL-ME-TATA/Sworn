"""Discovery, liveness, reputation and feedback for both registries.
Reads the 8004 indexer and SATI data directly; anything that needs the Solana SDK goes through the registry bridge."""
import asyncio
import json
import re

import httpx

from . import store
from .config import AGENT_LIST, CONFIG, DATA, ROLE_SKILLS, agent_url

SATI_API = "https://sati.cascade.fyi/api"
AGENT_FIELDS = "id owner agentURI registrationFile { name active a2aEndpoint mcpEndpoint oasfSkills }"

_http = httpx.AsyncClient(timeout=30)


async def bridge(method: str, path: str, **kw):
    res = await _http.request(method, f"{CONFIG.REGISTRY_URL}{path}", **kw)
    body = res.json() if res.content else None
    if res.status_code >= 400:
        raise RuntimeError((body or {}).get("error") or f"registry bridge HTTP {res.status_code}")
    return body


_wallets = None


async def wallets() -> dict:
    global _wallets
    if _wallets is None:
        _wallets = await bridge("GET", "/wallets")
    return _wallets


async def _indexer_page(skip: int) -> list[dict]:
    """One page of agents. The indexer allows 60 requests a minute; when it says slow down, wait and retry."""
    for attempt in range(1, 5):
        res = await _http.post(CONFIG.INDEXER, json={
            "query": f"query($skip: Int) {{ agents(first: 250, skip: $skip, orderBy: createdAt, orderDirection: desc) {{ {AGENT_FIELDS} }} }}",
            "variables": {"skip": skip},
        })
        body = res.json()
        if body.get("data"):
            return body["data"]["agents"]
        error = body.get("error") or (body.get("errors") or [{}])[0].get("message") or f"HTTP {res.status_code}"
        if "rate" not in str(error).lower() or attempt == 4:
            raise RuntimeError(f"indexer: {error}")
        await asyncio.sleep(5 * attempt)
    raise RuntimeError("unreachable")


async def list_agents() -> list[dict]:
    """Every 8004 agent on devnet, 250 per page (the indexer's cap). Cached in Redis for 10 minutes; if the indexer
    is down or rate-limited, the last full copy is used, so a busy minute never stops a run."""
    hit = await store.redis.get("registry:agents")
    if hit:
        return json.loads(hit)
    try:
        out, skip = [], 0
        while True:
            page = await _indexer_page(skip)
            out += page
            if len(page) < 250:
                break
            skip += 250
    except Exception as err:  # noqa: BLE001
        last = await store.redis.get("registry:agents:last")
        if not last:
            raise
        print(f"indexer unavailable ({err}); using the last saved agent list")
        await store.redis.set("registry:agents", last, ex=120)  # the other roles reuse it instead of asking again
        return json.loads(last)
    body = json.dumps(out)
    await store.redis.set("registry:agents", body, ex=600)
    await store.redis.set("registry:agents:last", body)
    return out


def saved_agents() -> dict:
    path = DATA / "agents.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


async def _fetch_json(url: str):
    try:
        res = await _http.get(url, timeout=CONFIG.ALIVE_TIMEOUT)
        return res.json() if res.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None


async def our_candidates(all_agents: list[dict]) -> list[dict]:
    """Our agents: owned by OWNER, plus any saved by register.py that the indexer has not caught up with.
    Profiles are read straight from the registration file, which we serve."""
    owner = (await wallets()).get("owner")
    mine = {a["id"]: a["agentURI"] for a in all_agents if owner and a["owner"] == owner}
    for name, a in saved_agents().items():
        mine.setdefault(a["asset"], f"{agent_url(name)}/registration.json")
    if not mine:  # local dev before registration: no on-chain asset, so reputation and feedback are skipped
        mine = {f"unregistered:{a['name']}": f"{agent_url(a['name'])}/registration.json" for a in AGENT_LIST}
    out = []
    for asset, uri in mine.items():
        file = await _fetch_json(uri)
        if not file:
            continue  # an old agent we no longer serve
        svc = {s.get("name"): s for s in file.get("services", [])}
        if svc.get("A2A", {}).get("endpoint"):
            endpoint = svc["A2A"]["endpoint"]
            out.append({"asset": asset, "id": endpoint.rstrip("/").rsplit("/", 1)[-1], "name": file.get("name"), "endpoint": endpoint,
                        "skills": svc.get("OASF", {}).get("skills", []), "ours": True, "registry": "8004"})
    return out


def sati_data():
    path = DATA / "sati-agents.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def sati_candidates() -> list[dict]:
    """SATI agents read from the chain by registry/scripts/sati-sync.js. The same template endpoint is often
    registered many times, so each is tried once; agents on real domains go first."""
    seen, out = set(), []
    for a in (sati_data() or {}).get("agents", []):
        if a["endpoint"] not in seen:
            seen.add(a["endpoint"])
            out.append({"asset": a["mint"], "name": a.get("name") or a["mint"][:8], "endpoint": a["endpoint"],
                        "protocol": "mcp" if a.get("type") == "MCP" else "a2a",
                        "skills": a.get("skills", []), "ours": False, "registry": "sati"})
    return sorted(out, key=lambda a: bool(UNREACHABLE.search(a["endpoint"])))


# Addresses nobody else can reach, or template placeholders: not worth a candidate slot.
UNREACHABLE = re.compile(r"localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|example\.(com|org)|myagent\.com|your-?domain")


async def discover(role: str) -> list[dict]:
    """Candidates for a role: our agents whose skills match, plus third-party agents that declare the skill.
    Retrievers also get a few third-party agents with any endpoint from each registry, so real registry agents are tested."""
    all_agents = await list_agents()
    wanted = set(ROLE_SKILLS[role])
    matches = lambda skills: bool(wanted & set(skills or []))  # noqa: E731
    ours = [c for c in await our_candidates(all_agents) if matches(c["skills"])]
    owner = (await wallets()).get("owner")
    theirs = []
    for a in all_agents:
        f = a.get("registrationFile") or {}
        endpoint, protocol = (f.get("a2aEndpoint"), "a2a") if f.get("a2aEndpoint") else (f.get("mcpEndpoint"), "mcp")
        if a["owner"] != owner and endpoint:  # MCP-only agents count too
            theirs.append({"asset": a["id"], "owner": a["owner"], "name": f.get("name") or a["id"][:8], "endpoint": endpoint, "protocol": protocol,
                           "skills": f.get("oasfSkills") or [], "ours": False, "registry": "8004"})
    sati = sati_candidates()
    extra = []
    if role == "retriever":
        def reachable(pool, n):  # one candidate per address, and none that nobody could reach
            seen, picked = set(), []
            for t in pool:
                if not matches(t["skills"]) and not UNREACHABLE.search(t["endpoint"]) and t["endpoint"] not in seen:
                    seen.add(t["endpoint"])
                    picked.append(t)
            return picked[:n]
        extra = reachable(theirs, CONFIG.THIRD_PARTY_RETRIEVERS) + reachable(sati, CONFIG.SATI_RETRIEVERS)
    return (ours + [t for t in theirs if matches(t["skills"])] + [t for t in sati if matches(t["skills"])] + extra)[:CONFIG.MAX_CANDIDATES]


async def registry_stats() -> dict:
    """How many devnet agents can be called at all, in both registries (shown in the demo)."""
    all_agents = await list_agents()
    rf = lambda a: a.get("registrationFile") or {}  # noqa: E731
    stats = {
        "total": len(all_agents),
        "with_profile": sum(1 for a in all_agents if rf(a).get("name")),
        "with_endpoint": sum(1 for a in all_agents if rf(a).get("a2aEndpoint") or rf(a).get("mcpEndpoint")),
        "with_skills": sum(1 for a in all_agents if rf(a).get("oasfSkills")),
    }
    sati = sati_data()
    if sati:
        stats["sati"] = {"total": sati["total"], "with_profile": sati["readable"], "with_endpoint": len(sati["agents"]), "synced_at": sati["synced_at"]}
    return stats


async def ping(url: str) -> bool:
    try:
        res = await _http.head(url, timeout=CONFIG.ALIVE_TIMEOUT)
        return res.status_code < 400 or res.status_code in (401, 402, 403, 405)
    except Exception:  # noqa: BLE001
        return False


async def mcp_tools(url: str) -> list[dict] | None:
    """MCP handshake (initialize, then tools/list). Returns the server's tools, or None if it is not a working MCP server.
    MCP servers reject the HEAD request a plain ping sends, so this is how an MCP agent's liveness is checked."""
    headers = {"accept": "application/json, text/event-stream"}

    def body(res) -> dict:  # plain JSON, or one server-sent event carrying it
        m = re.search(r"\{.*\}", res.text, re.S)
        return json.loads(m.group(0)) if m else {}

    try:
        res = await _http.post(url, headers=headers, timeout=CONFIG.ALIVE_TIMEOUT, json={
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "sworn", "version": "0.2"}}})
        if res.status_code != 200 or "result" not in body(res):
            return None
        if res.headers.get("mcp-session-id"):
            headers["mcp-session-id"] = res.headers["mcp-session-id"]
        await _http.post(url, headers=headers, timeout=CONFIG.ALIVE_TIMEOUT, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        res = await _http.post(url, headers=headers, timeout=CONFIG.ALIVE_TIMEOUT, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        return (body(res).get("result") or {}).get("tools", [])
    except Exception:  # noqa: BLE001
        return None


async def is_alive(c: dict) -> bool:
    """MCP servers get a real MCP handshake. Otherwise the SDK's isItAlive pings the services in the on-chain
    profile; it refuses localhost and cannot check SATI assets, so then we ping the endpoint ourselves."""
    if c.get("protocol") == "mcp":
        c["tools"] = await mcp_tools(c["endpoint"])
        return c["tools"] is not None
    if c["registry"] == "8004" and not c["asset"].startswith("unregistered"):
        try:
            if (await bridge("GET", f"/alive/{c['asset']}"))["status"] not in ("not_live", "unknown"):
                return True
        except Exception:  # noqa: BLE001
            pass
    return await ping(c["endpoint"])


async def operator_wallets(candidate: dict) -> set[str]:
    """Wallets run by the agent's own operator: their ratings of it are self-ratings and do not count.
    For our agents that is both our wallets (owner and reviewer); for anyone else, the agent's owner."""
    if candidate.get("ours"):
        return {w for w in (await wallets()).values() if w}
    return {candidate["owner"]} if candidate.get("owner") else set()


async def get_score(asset: str, registry: str = "8004", exclude: set[str] = frozenset()) -> dict | None:
    """{average, count, self_count} of independent on-chain ratings, or None when there are none.
    8004 ratings are read one by one with the wallet that gave each, so ratings from `exclude` (the agent's own
    operator) are left out of the average. SATI's API only gives a total, so its agents' scores cannot be split."""
    if asset.startswith("unregistered"):
        return None
    if registry == "8004":
        try:
            ratings = await bridge("GET", f"/ratings/{asset}")
        except Exception:  # noqa: BLE001 - unknown is treated like a new agent, never as a pass
            return None
        independent = [r["score"] for r in ratings if r["client"] not in exclude and r["score"] is not None]
        self_count = len(ratings) - len(independent)
        if not independent:
            return {"average": None, "count": 0, "self_count": self_count} if self_count else None
        return {"average": round(sum(independent) / len(independent), 1), "count": len(independent), "self_count": self_count}
    if registry == "sati":
        try:
            res = await _http.get(f"{SATI_API}/reputation/{asset}?network=devnet", timeout=CONFIG.ALIVE_TIMEOUT * 2)
            r = res.json()
            if res.status_code == 200 and r.get("count", 0) > 0:
                return {"average": round(float(r["summaryValue"]) / 10 ** (r.get("summaryValueDecimals") or 0), 1), "count": r["count"]}
        except Exception:  # noqa: BLE001 - SATI's API is often down; an unknown score is treated like a new agent
            pass
        return None


def _fit(s: str, max_bytes: int) -> str:
    return str(s).encode()[:max_bytes].decode(errors="ignore")


async def give_feedback(asset: str, *, score: int, role: str, outcome: str, endpoint: str | None, report_url: str, registry: str = "8004") -> str:
    if registry == "sati":
        # SATI's public feedback endpoint signs and pays for the attestation itself; content is capped at 100 bytes,
        # so only the score and the two tags go on-chain.
        res = await _http.post(f"{SATI_API}/feedback", timeout=30, json={
            "network": "devnet", "agentMint": asset, "value": score, "tag1": _fit(role, 24), "tag2": _fit(outcome, 24),
            "outcome": 2 if score >= 70 else 1 if score >= 40 else 0,
        })
        body = res.json() if res.content else {}
        if res.status_code >= 400:
            raise RuntimeError(f"SATI {res.status_code}: {body.get('error', '')}")
        return body["txSignature"]
    body = await bridge("POST", "/feedback", json={"asset": asset, "score": score, "role": role, "outcome": outcome,
                                                   "endpoint": endpoint, "reportUrl": report_url})
    return body["tx"]


def registration_file(agent: dict) -> dict:
    """ERC-8004 registration file, same shape the 8004-solana SDK's buildRegistrationFileJson produces:
    the A2A endpoint plus an OASF entry carrying the skills."""
    endpoint = agent_url(agent["name"])
    return {
        "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        "name": agent["title"],
        "description": agent["description"],
        "services": [
            {"name": "A2A", "endpoint": endpoint},
            {"name": "OASF", "endpoint": f"{endpoint}/registration.json", "skills": ROLE_SKILLS[agent["role"]]},
        ],
        "active": True,
        "x402Support": False,
    }
