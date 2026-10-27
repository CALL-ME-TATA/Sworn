"""In-process MCP session: call sworn_init before research / debug tools."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Session:
    ready: bool = False
    api_url: str = ""
    health: dict[str, Any] = field(default_factory=dict)
    inited_at: str | None = None
    last_run_id: str | None = None

    def mark_ready(self, api_url: str, health: dict[str, Any]) -> None:
        self.ready = True
        self.api_url = api_url
        self.health = health
        self.inited_at = datetime.now(timezone.utc).isoformat()

    def remember_run(self, run_id: str | None) -> None:
        if run_id:
            self.last_run_id = run_id


SESSION = Session()

# Full catalog returned by sworn_init (and when a tool is called too early).
COMMANDS: dict[str, list[dict[str, Any]]] = {
    "session": [
        {
            "name": "sworn_init",
            "required_first": True,
            "args": {},
            "about": (
                "Open the MCP session + handshake with the Sworn API. Returns product "
                "description, this catalog, defaults, call examples, health, and next steps. "
                "Call once per MCP server process before research; later turns reuse SESSION."
            ),
            "example": "sworn_init()",
        },
        {
            "name": "sworn_status",
            "args": {},
            "about": (
                "Session ready flag, API URL, backend health snapshot, last run_id, and whether "
                "a run is currently locked. Call after sworn_init."
            ),
            "example": "sworn_status()",
        },
    ],
    "research": [
        {
            "name": "research_brief",
            "args": {"question": "string (required)"},
            "maps_to": {"length": "short", "reasoning": "light"},
            "defaults": {"length": "short", "reasoning": "light"},
            "about": (
                "Fast verified research. Short answer (~60–100 words), light reasoning "
                "(2 sub-questions). Returns plain text for the user — not JSON."
            ),
            "returns": "plain text (answer + footer)",
            "example": 'research_brief(question="When was penicillin discovered?")',
        },
        {
            "name": "research_standard",
            "args": {"question": "string (required)"},
            "maps_to": {"length": "medium", "reasoning": "standard"},
            "defaults": {"length": "medium", "reasoning": "standard"},
            "about": (
                "Default verified research. Medium answer, standard reasoning "
                "(3 sub-questions). Returns plain text for the user — not JSON."
            ),
            "returns": "plain text (answer + footer)",
            "example": 'research_standard(question="How does penicillin kill bacteria?")',
        },
        {
            "name": "research_deep",
            "args": {"question": "string (required)"},
            "maps_to": {"length": "long", "reasoning": "high"},
            "defaults": {"length": "long", "reasoning": "high"},
            "about": (
                "Thorough verified research. Long answer, high reasoning "
                "(4 sub-questions). Returns plain text for the user — not JSON."
            ),
            "returns": "plain text (answer + footer)",
            "example": 'research_deep(question="Compare β-lactam antibiotics and resistance mechanisms")',
        },
        {
            "name": "run_research",
            "args": {
                "question": "string (required)",
                "length": "short | medium | long",
                "reasoning": "light | standard | high",
                "kill": "bool — demo failover only",
            },
            "defaults": {"length": "medium", "reasoning": "standard", "kill": False},
            "about": (
                "Custom knobs when the user names length or depth in natural language. "
                "Blocks until finished; returns plain text (answer + footer), not JSON."
            ),
            "returns": "plain text (answer + footer)",
            "example": (
                'run_research(question="What caused the Chernobyl disaster?", '
                'length="long", reasoning="high")'
            ),
        },
    ],
    "inspect": [
        {
            "name": "get_evidence",
            "args": {"run_id": "optional string; default = last run in this session or latest"},
            "defaults": {"run_id": None},
            "about": (
                "Claims with quotes, sources, producer/verifier agents, and supported status. "
                "Use when the user wants proof."
            ),
            "example": 'get_evidence(run_id="run_…")  # or get_evidence() for last run',
        },
        {
            "name": "get_hiring",
            "args": {"run_id": "optional string; default = last run in this session or latest"},
            "defaults": {"run_id": None},
            "about": (
                "Hiring/screening table (reputation / alive / benchmark) and failovers. "
                "Use when the user asks who was hired."
            ),
            "example": 'get_hiring(run_id="run_…")  # or get_hiring() for last run',
        },
    ],
    "debug": [
        {
            "name": "debug_get_run",
            "args": {"run_id": "optional"},
            "defaults": {"run_id": None},
            "about": (
                "Full run report as JSON. Call only when the user asks for a report or JSON dump. "
                "Research tools already return the answer as plain text."
            ),
            "returns": "JSON",
            "example": "debug_get_run()",
        },
        {
            "name": "debug_get_validations",
            "args": {"run_id": "string (required)"},
            "about": "Postgres validation records for each claim in the run.",
            "example": 'debug_get_validations(run_id="run_…")',
        },
        {
            "name": "debug_get_timing",
            "args": {"run_id": "optional"},
            "defaults": {"run_id": None},
            "about": "Per-step timings and every agent call for a run.",
            "example": "debug_get_timing()",
        },
        {
            "name": "debug_get_benchmarks",
            "args": {},
            "about": "Latest sab-v1 benchmark scores for screened agents.",
            "example": "debug_get_benchmarks()",
        },
        {
            "name": "debug_compare",
            "args": {},
            "about": "Fixed-team baseline vs Sworn unsupported-claim comparison.",
            "example": "debug_compare()",
        },
        {
            "name": "debug_kill_agent",
            "args": {"name": "string (required) — agent name"},
            "about": "Demo: take an agent offline (localhost only; no auth).",
            "example": 'debug_kill_agent(name="retriever-a")',
        },
        {
            "name": "debug_revive_agent",
            "args": {"name": "string (required) — agent name"},
            "about": "Demo: bring a killed agent back online.",
            "example": 'debug_revive_agent(name="retriever-a")',
        },
    ],
}

DEFAULTS: dict[str, Any] = {
    "run_research": {"length": "medium", "reasoning": "standard", "kill": False},
    "presets": {
        "research_brief": {"length": "short", "reasoning": "light"},
        "research_standard": {"length": "medium", "reasoning": "standard"},
        "research_deep": {"length": "long", "reasoning": "high"},
    },
    "inspect_run_id": "last run from this MCP session, else latest on the API",
}

EXAMPLES: list[dict[str, str]] = [
    {
        "when": "User says init / start sworn / connect",
        "call": "sworn_init()",
    },
    {
        "when": "Quick / short answer",
        "call": 'research_brief(question="<user question>")',
    },
    {
        "when": "Default / balanced (no depth specified)",
        "call": 'research_standard(question="<user question>")',
    },
    {
        "when": "Thorough / long / deep dive",
        "call": 'research_deep(question="<user question>")',
    },
    {
        "when": "User names length or reasoning",
        "call": 'run_research(question="...", length="long", reasoning="high")',
    },
    {
        "when": "Show proof / quotes / sources",
        "call": "get_evidence()  # or pass run_id from the research result",
    },
    {
        "when": "Who was hired / screening table",
        "call": "get_hiring()",
    },
    {
        "when": "Engineering dump of the run",
        "call": "debug_get_run() / debug_get_timing() / debug_get_validations(run_id=...)",
    },
]

DESCRIPTION = (
    "Sworn is a trusted-agent hiring research system. It discovers agents from Solana registries "
    "(8004 / SATI), screens them (independent reputation, liveness, sab-v1 benchmark), runs a "
    "LangGraph pipeline (hire → plan → retrieve → read → reason → verify → generate → record), "
    "and returns a cited answer where every claim is checked against its source. Performance is "
    "written back on-chain. This MCP talks to a local Sworn API (default http://localhost:3001); "
    "keep docker compose up. Do not ask clarifying questions for the user — run the question as given. "
    "Research tools block until the run finishes and return answer + run_id. Inspect the same run "
    "in the web debugger at http://localhost:3000/app (MCP runs are tagged source=mcp)."
)

# Human-facing brief meant to be shown after a successful init (agents should surface this).
GUIDE = """# Sworn — what it does

Sworn hires research agents from open Solana registries, screens each one (reputation, liveness, sab-v1 benchmark), runs a verified multi-agent pipeline, and returns a **cited answer** where every claim is checked against its source. Results are recorded on-chain. This MCP session talks to your local API; keep `docker compose up`.

## Defaults

| Setting | Default |
|---------|---------|
| Research preset when unspecified | `research_standard` |
| `run_research` length | `medium` |
| `run_research` reasoning | `standard` |
| `run_research` kill (demo) | `false` |
| Inspect `run_id` when omitted | last run in this session, else latest |

## Session flow (important)

1. Call **`sworn_init()`** once (MCP tool — not a shell). Show the catalog to the user.
2. On a **later** turn, call a research tool by name from that catalog (same MCP process = same session).
3. Do **not** wrap `sworn_init` + research in one shell command; that creates a throwaway process and loses the session.

## How to call tools (examples)

```
sworn_init()
sworn_status()

research_brief(question="When was penicillin discovered?")
research_standard(question="How does penicillin kill bacteria?")   # default
research_deep(question="Compare β-lactam antibiotics and resistance")

run_research(question="What caused Chernobyl?", length="long", reasoning="high")

get_evidence()                         # last run
get_evidence(run_id="run_…")
get_hiring()
debug_get_run()
debug_get_timing()
debug_get_validations(run_id="run_…")
debug_get_benchmarks()
debug_compare()
debug_kill_agent(name="retriever-a")   # localhost demo only
debug_revive_agent(name="retriever-a")
```

## Command groups

- **session** — `sworn_init` (required first), `sworn_status`
- **research** — `research_brief` / `research_standard` / `research_deep` / `run_research`
- **inspect** — `get_evidence`, `get_hiring`
- **debug** — `debug_get_run`, `debug_get_validations`, `debug_get_timing`, `debug_get_benchmarks`, `debug_compare`, `debug_kill_agent`, `debug_revive_agent`

Research tools **block until finished** and return **plain text** (the answer + a short footer). Show that prose to the user — do not paste JSON. Full JSON report only via `debug_get_run` when the user asks for a report.

Web debugger: http://localhost:3000/app
"""


def catalog_payload() -> dict[str, Any]:
    """Shared description + command catalog for sworn_init and not_initialized responses."""
    return {
        "description": DESCRIPTION,
        "guide": GUIDE,
        "commands": COMMANDS,
        "defaults": DEFAULTS,
        "examples": EXAMPLES,
        "presets": DEFAULTS["presets"],
        "ui": "http://localhost:3000/app",
    }


def not_ready_payload() -> dict[str, Any]:
    return {
        "ok": False,
        "error": "not_initialized",
        "hint": (
            "Call sworn_init first (MCP tool, not shell). It returns the full product "
            "description, command catalog, defaults, and call examples. Then on a later "
            "turn call research_brief, research_standard, research_deep, or run_research."
        ),
        **catalog_payload(),
    }
