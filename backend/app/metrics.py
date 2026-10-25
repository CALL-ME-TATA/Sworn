"""Prometheus metrics, served at /metrics."""
from prometheus_client import Counter, Histogram

RUNS = Counter("sworn_runs_total", "Runs finished", ["outcome"])
RUN_SECONDS = Histogram("sworn_run_seconds", "Run duration", buckets=(10, 20, 30, 45, 60, 90, 120, 180, 300))
SCREENED = Counter("sworn_candidates_screened_total", "Candidates screened", ["role", "result", "stage"])
CALLS = Counter("sworn_agent_calls_total", "Calls to hired agents", ["role", "result"])
FAILOVERS = Counter("sworn_failovers_total", "Backups that took over a task", ["role"])
CLAIMS = Counter("sworn_claims_total", "Claims checked by a verifier", ["verdict"])
FEEDBACK = Counter("sworn_feedback_total", "Scores written back", ["registry", "result"])
