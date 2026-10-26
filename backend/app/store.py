"""Postgres keeps every run, validation record and feedback entry; Redis keeps the live run, caches and locks."""
import json

import asyncpg
import redis.asyncio as aioredis

from .config import CONFIG

SCHEMA = """
create table if not exists runs (
  id text primary key,
  question text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  error text,
  report jsonb not null
);
create table if not exists validation_records (
  run_id text not null references runs(id) on delete cascade,
  claim_id text not null,
  claim text not null,
  quote text,
  source_url text,
  producer text,
  producer_name text,
  verifier text,
  verifier_name text,
  verdict text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (run_id, claim_id)
);
create table if not exists feedback (
  run_id text not null references runs(id) on delete cascade,
  asset text not null,
  name text,
  role text,
  registry text,
  score int,
  outcome text,
  tx text,
  error text,
  primary key (run_id, asset, role)
);
create table if not exists benchmarks (
  id serial primary key,
  asset text not null,
  name text,
  role text not null,
  version text not null,
  day date not null,
  score real not null,
  report jsonb not null,
  tx text,
  created_at timestamptz not null default now()
);
create index if not exists benchmarks_lookup on benchmarks (asset, role, version, day);
create table if not exists comparisons (
  id serial primary key,
  created_at timestamptz not null default now(),
  data jsonb not null
);
"""

pool: asyncpg.Pool | None = None
redis: aioredis.Redis | None = None


async def connect():
    global pool, redis
    redis = aioredis.from_url(CONFIG.REDIS_URL, decode_responses=True)
    pool = await asyncpg.create_pool(CONFIG.DATABASE_URL, min_size=1, max_size=5)
    async with pool.acquire() as con:
        await con.execute(SCHEMA)


async def close():
    if pool:
        await pool.close()
    if redis:
        await redis.aclose()


async def save_run(r: dict, latest: bool = True):
    body = json.dumps(r)
    await pool.execute(
        """insert into runs (id, question, started_at, finished_at, error, report)
           values ($1, $2, $3::text::timestamptz, $4::text::timestamptz, $5, $6::jsonb)
           on conflict (id) do update set finished_at = excluded.finished_at, error = excluded.error, report = excluded.report""",
        r["run_id"], r["question"], r["started_at"], r.get("finished_at"), r.get("error"), body,
    )
    if latest:
        await redis.set("run:latest", body)


async def save_records(r: dict):
    """Validation records (who made each claim, who checked it, the verdict) and the feedback written for each agent."""
    async with pool.acquire() as con, con.transaction():
        await con.executemany(
            """insert into validation_records (run_id, claim_id, claim, quote, source_url, producer, producer_name, verifier, verifier_name, verdict, reason)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing""",
            [(r["run_id"], c["id"], c["text"], c.get("quote"), c.get("source_url"), c.get("produced_by"), c.get("produced_by_name"),
              c.get("verified_by"), c.get("verified_by_name"), c["status"], c.get("reason")) for c in r["claims"] if c["status"] != "pending"],
        )
        await con.executemany(
            """insert into feedback (run_id, asset, name, role, registry, score, outcome, tx, error)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing""",
            [(r["run_id"], f["asset"], f["name"], f["role"], f["registry"], f["score"], f["outcome"], f.get("tx"), f.get("error")) for f in r["feedback"]],
        )


async def latest_run() -> dict | None:
    body = await redis.get("run:latest")
    if body:
        return json.loads(body)
    row = await pool.fetchrow("select report from runs order by started_at desc limit 1")
    return json.loads(row["report"]) if row else None


async def get_run(run_id: str) -> dict | None:
    row = await pool.fetchrow("select report from runs where id = $1", run_id)
    return json.loads(row["report"]) if row else None


async def list_runs(limit: int = 20) -> list[dict]:
    rows = await pool.fetch(
        """select id, question, started_at, finished_at, error,
                  report->'metrics'->>'claims_supported' as supported, report->'metrics'->>'claims' as claims
           from runs order by started_at desc limit $1""", limit)
    return [{**dict(x), "started_at": x["started_at"].isoformat(), "finished_at": x["finished_at"] and x["finished_at"].isoformat()} for x in rows]


async def validations(run_id: str) -> list[dict]:
    rows = await pool.fetch("select * from validation_records where run_id = $1 order by claim_id", run_id)
    return [{**dict(x), "created_at": x["created_at"].isoformat()} for x in rows]


async def todays_benchmark(asset: str, role: str, version: str, day) -> dict | None:
    row = await pool.fetchrow("""select id, tx, report from benchmarks where asset = $1 and role = $2 and version = $3 and day = $4
                                 order by id desc limit 1""", asset, role, version, day)
    return {**json.loads(row["report"]), "id": row["id"], "tx": row["tx"]} if row else None


async def save_benchmark(asset: str, name: str, role: str, version: str, day, report: dict) -> int:
    return await pool.fetchval("""insert into benchmarks (asset, name, role, version, day, score, report)
                                  values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id""",
                               asset, name, role, version, day, report["score"], json.dumps(report))


async def set_benchmark_tx(bench_id: int, tx: str):
    await pool.execute("update benchmarks set tx = $2 where id = $1", bench_id, tx)


async def get_benchmark(bench_id: int) -> dict | None:
    row = await pool.fetchrow("select * from benchmarks where id = $1", bench_id)
    if not row:
        return None
    return {**dict(row), "day": row["day"].isoformat(), "created_at": row["created_at"].isoformat(), "report": json.loads(row["report"])}


async def list_benchmarks(limit: int = 100) -> list[dict]:
    rows = await pool.fetch("""select distinct on (asset, role) id, asset, name, role, version, day, score, tx, created_at,
                                      report->'aspects' as aspects
                               from benchmarks order by asset, role, id desc""")
    out = [{**dict(r), "day": r["day"].isoformat(), "created_at": r["created_at"].isoformat(), "aspects": json.loads(r["aspects"])} for r in rows]
    return sorted(out, key=lambda r: (r["role"], -r["score"]))[:limit]


async def save_comparison(data: dict):
    await pool.execute("insert into comparisons (data) values ($1::jsonb)", json.dumps(data))


async def latest_comparison() -> dict | None:
    row = await pool.fetchrow("select data from comparisons order by id desc limit 1")
    return json.loads(row["data"]) if row else None
