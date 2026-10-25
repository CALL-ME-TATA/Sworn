"""Discovery, liveness, reputation and feedback for both registries.
Reads the 8004 indexer and SATI data directly; anything that needs the Solana SDK goes through the registry bridge."""
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


async def list_agents() -> list[dict]:
    """Every 8004 agent on devnet, 250 per page (the indexer's cap). Cached in Redis for 10 minutes."""
    hit = await store.redis.get("registry:agents")
    if hit:
        return json.loads(hit)
    out, skip = [], 0
    while True:
        res = await _http.post(CONFIG.INDEXER, json={
            "query": f"query($skip: Int) {{ agents(first: 250, skip: $skip, orderBy: createdAt, orderDirection: desc) {{ {AGENT_FIELDS} }} }}",
            "variables": {"skip": skip},
        })
        body = res.json()
        if body.get("errors"):
            raise RuntimeError(f"indexer: {body['errors'][0]['message']}")
        page = body["data"]["agents"]
        out += page
        if len(page) < 250:
            break
        skip += 250
    await store.redis.set("registry:agents", json.dumps(out), ex=600)
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
            out.append({"asset": asset, "name": file.get("name"), "endpoint": svc["A2A"]["endpoint"],
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
                        "skills": a.get("skills", []), "ours": False, "registry": "sati"})
    return sorted(out, key=lambda a: bool(re.search(r"example\.com|myagent\.com", a["endpoint"])))


async def discover(role: str) -> list[dict]:
    """Candidates for a role: our agents whose skills match, plus third-party agents that declare the skill.
    Retrievers also get a few third-party agents with any endpoint from each registry, so real registry agents are tested."""
    all_agents = await list_agents()
    wanted = set(ROLE_SKILLS[role])
    matches = lambda skills: bool(wanted & set(skills or []))  # noqa: E731
    ours = [c for c in await our_candidates(all_agents) if matches(c["skills"])]
    owner = (await wallets()).get("owner")
    theirs = [{"asset": a["id"], "name": (a["registrationFile"] or {}).get("name") or a["id"][:8],
               "endpoint": a["registrationFile"]["a2aEndpoint"], "skills": a["registrationFile"].get("oasfSkills") or [],
               "ours": False, "registry": "8004"}
              for a in all_agents if a["owner"] != owner and (a.get("registrationFile") or {}).get("a2aEndpoint")]
    sati = sati_candidates()
    extra = []
    if role == "retriever":
        extra = [t for t in theirs if not matches(t["skills"])][:CONFIG.THIRD_PARTY_RETRIEVERS] + \
                [t for t in sati if not matches(t["skills"])][:CONFIG.SATI_RETRIEVERS]
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


async def is_alive(c: dict) -> bool:
    """The SDK's isItAlive pings the services in the on-chain profile. It refuses localhost and cannot check
    SATI assets, so then we ping the endpoint ourselves."""
    if c["registry"] == "8004" and not c["asset"].startswith("unregistered"):
        try:
            if (await bridge("GET", f"/alive/{c['asset']}"))["status"] not in ("not_live", "unknown"):
                return True
        except Exception:  # noqa: BLE001
            pass
    return await ping(c["endpoint"])


async def get_score(asset: str, registry: str = "8004") -> dict | None:
    """{average, count} of on-chain feedback, or None when the agent has none (or no on-chain asset yet)."""
    if asset.startswith("unregistered"):
        return None
    if registry == "sati":
        try:
            res = await _http.get(f"{SATI_API}/reputation/{asset}?network=devnet", timeout=CONFIG.ALIVE_TIMEOUT * 2)
            r = res.json()
            if res.status_code == 200 and r.get("count", 0) > 0:
                return {"average": round(float(r["summaryValue"]) / 10 ** (r.get("summaryValueDecimals") or 0), 1), "count": r["count"]}
        except Exception:  # noqa: BLE001 - SATI's API is often down; an unknown score is treated like a new agent
            pass
        return None
    try:
        return await bridge("GET", f"/score/{asset}")
    except Exception:  # noqa: BLE001
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
        "name": agent["name"],
        "description": agent["description"],
        "services": [
            {"name": "A2A", "endpoint": endpoint},
            {"name": "OASF", "endpoint": f"{endpoint}/registration.json", "skills": ROLE_SKILLS[agent["role"]]},
        ],
        "active": True,
        "x402Support": False,
    }
