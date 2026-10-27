"""FastAPI app: hosts our agents (good and deliberately bad) and their registration files, an admin kill switch
for the failover demo, the run API the frontend uses, health and Prometheus metrics."""
import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import store
from .agents import HANDLERS
from .llm import ProviderLimit
from .config import AGENT_LIST, CONFIG, DATA, LENGTHS, REASONING
from .orchestrator import clarify, run
from .registry import list_agents, registration_file
from .sources import seed_cache

BY_NAME = {a["name"]: a for a in AGENT_LIST}
running: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await store.connect()
    # A run cut off by a restart must not leave an agent switched off, or block new runs until its lock expires.
    await store.redis.delete("agents:killed", "run:lock")
    await seed_cache()

    async def preload():  # read the whole registry once, so the first run does not wait on ~20 indexer pages
        try:
            print(f"registry loaded: {len(await list_agents())} agents")
        except Exception as err:  # noqa: BLE001
            print(f"registry preload failed: {err}")

    asyncio.create_task(preload())
    print(f"agents on {CONFIG.AGENTS_BASE_URL} (port {CONFIG.PORT}), {CONFIG.PROVIDER} · {CONFIG.MODEL}" if CONFIG.LLM else "rule-based mode")
    yield
    await store.close()


app = FastAPI(title="Sworn - Trusted Agent Hiring", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])


# ---------- agents ----------

def _agent(name: str) -> dict:
    if name not in BY_NAME:
        raise HTTPException(404, "unknown agent")
    return BY_NAME[name]


@app.get("/agents/{name}/registration.json")
async def agent_registration(name: str):
    return registration_file(_agent(name))


@app.api_route("/agents/{name}", methods=["GET", "HEAD"])
async def agent_card(name: str):
    a = _agent(name)
    if await store.redis.sismember("agents:killed", name):
        return JSONResponse({"error": "agent offline"}, status_code=503)
    return {"id": a["name"], "name": a["title"], "role": a["role"], "description": a["description"]}


@app.post("/agents/{name}")
async def agent_task(name: str, request: Request):
    if name not in HANDLERS:
        raise HTTPException(404, "unknown agent")
    if await store.redis.sismember("agents:killed", name):
        return JSONResponse({"error": "agent offline"}, status_code=503)
    body = await request.json()
    task_id = body.get("task_id")
    try:
        return {"task_id": task_id, "output": await HANDLERS[name](body.get("input") or {})}
    except ProviderLimit as err:  # our AI provider is out of quota: "busy", not a broken agent
        return JSONResponse({"task_id": task_id, "error": str(err), "reason": "provider-limit", "retry_after": err.retry_after},
                            status_code=429, headers={"Retry-After": str(int(err.retry_after or 60))})
    except Exception as err:  # noqa: BLE001
        print(f"{name} {task_id}: {err}")
        return JSONResponse({"task_id": task_id, "error": str(err)}, status_code=500)


@app.post("/admin/{action}/{name}")
async def admin(action: str, name: str):
    # ponytail: no auth, like the rest of the demo API; put it behind a token before exposing the server publicly.
    if action == "kill":
        await store.redis.sadd("agents:killed", name)
    elif action == "revive":
        await store.redis.srem("agents:killed", name)
    else:
        raise HTTPException(404, "use kill or revive")
    return {"killed": sorted(await store.redis.smembers("agents:killed"))}


# ---------- runs ----------
# One run at a time (a Redis lock, so a second backend instance would respect it too); the page polls /api/runs/latest.
# ponytail: no auth, so anyone who can reach this server can start runs (and spend SOL on feedback). Fine on localhost.

@app.get("/api/status")
async def status():
    return {"running": bool(await store.redis.exists("run:lock"))}


@app.post("/api/run", status_code=202)
async def start_run(request: Request):
    global running
    body = await request.json()
    question = str(body.get("question") or "").strip()[:300]
    if not question:
        raise HTTPException(400, "question is required")
    length, reasoning = body.get("length") or "medium", body.get("reasoning") or "standard"
    if length not in LENGTHS or reasoning not in REASONING:
        raise HTTPException(400, f"length must be one of {list(LENGTHS)} and reasoning one of {list(REASONING)}")
    if not await store.redis.set("run:lock", "1", nx=True, ex=600):
        raise HTTPException(409, "a run is already in progress")

    async def go():
        try:
            await run(question, kill=bool(body.get("kill")), length=length, reasoning=reasoning)
        except Exception as err:  # noqa: BLE001
            print(f"run failed: {err}")
        finally:
            await store.redis.delete("run:lock")

    running = asyncio.create_task(go())
    return {"started": True}


@app.post("/api/clarify")
async def api_clarify(request: Request):
    """Ask which meaning the user intends (before a run), or what to try instead (after a run found nothing).
    A failure here never blocks a run: the page treats it as clear and goes ahead."""
    body = await request.json()
    question = str(body.get("question") or "").strip()[:300]
    if not question:
        raise HTTPException(400, "question is required")
    try:
        return await clarify(question, bool(body.get("notFound")))
    except Exception as err:  # noqa: BLE001
        print(f"clarify failed: {err}")
        return {"clear": True}


@app.get("/api/runs/latest")
async def latest():
    r = await store.latest_run()
    if not r:
        raise HTTPException(404, "no runs yet")
    return r


@app.get("/api/runs")
async def runs(limit: int = 20):
    return await store.list_runs(min(limit, 100))


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    r = await store.get_run(run_id)
    if not r:
        raise HTTPException(404, "unknown run")
    return r


@app.get("/api/runs/{run_id}/validations")
async def validations(run_id: str):
    return await store.validations(run_id)


@app.get("/api/benchmarks")
async def benchmarks():
    """Latest standard-benchmark result for every agent, best first within each role."""
    return await store.list_benchmarks()


@app.get("/api/benchmarks/{bench_id}")
async def benchmark(bench_id: int):
    """One full benchmark report: every item, its aspect and score. On-chain ratings tagged sab-v1 link here."""
    b = await store.get_benchmark(bench_id)
    if not b:
        raise HTTPException(404, "unknown benchmark")
    return b


@app.get("/api/compare")
async def compare():
    data = await store.latest_comparison()
    if not data:
        path = DATA / "compare.json"  # the first comparison, measured before the Python rewrite
        if not path.exists():
            raise HTTPException(404, "no comparison yet")
        data = json.loads(path.read_text(encoding="utf-8"))
    return data


# ---------- monitoring ----------

@app.get("/api/health")
async def health():
    checks = {}
    for name, probe in (("postgres", lambda: store.pool.fetchval("select 1")), ("redis", store.redis.ping)):
        try:
            await probe()
            checks[name] = "ok"
        except Exception as err:  # noqa: BLE001
            checks[name] = f"down: {err}"
    ok = all(v == "ok" for v in checks.values())
    return JSONResponse({"ok": ok, **checks}, status_code=200 if ok else 503)


@app.get("/metrics")
async def prometheus():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
