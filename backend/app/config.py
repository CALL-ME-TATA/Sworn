"""Settings, the role -> skill map and the list of our agents. Every tunable number lives here."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]  # project root locally; /srv in the container
load_dotenv(ROOT / ".env")  # in Docker the env comes from compose instead

DATA = Path(os.getenv("DATA_DIR", ROOT / "data"))

_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
_DEFAULT_MODEL = {"groq": "openai/gpt-oss-120b", "openai": "gpt-4.1-mini", "gemini": "gemini-2.5-flash"}


class CONFIG:
    MAX_CANDIDATES = 11        # trialled per role
    MIN_SCORE = 40             # average feedback below this = skip...
    MIN_FEEDBACKS = 3          # ...but only once there are this many ratings, so one unlucky trial is not a ban
    BENCH_MIN_SCORE = 60       # standard benchmark score (0-100, equal-weight aspects) needed to be hired
    ALIVE_TIMEOUT = 5.0
    TRIAL_TIMEOUT = 30.0       # long enough for the LLM client to wait out a rate-limit pause
    TASK_TIMEOUT = 30.0
    BREAKER_FAILS = 3          # consecutive bad replies before an agent is marked dead
    SUBQUESTIONS = 3
    THIRD_PARTY_RETRIEVERS = 5  # real 8004 registry agents from other people, one per reachable address
    SATI_RETRIEVERS = 3         # and the same from the SATI registry
    FEEDBACK_CONCURRENCY = int(os.getenv("FEEDBACK_CONCURRENCY", "1"))  # on-chain score writes in flight at once
    SATI_FEEDBACK = os.getenv("SATI_FEEDBACK") == "on"  # write scores to SATI too (through SATI's public API)
    INDEXER = "https://8004-indexer-dev.qnt.sh/v2/graphql"
    PROVIDER = _PROVIDER
    MODEL = os.getenv("MODEL") or _DEFAULT_MODEL.get(_PROVIDER, "gpt-4.1-mini")
    LLM = os.getenv("LLM", "on") != "off"  # LLM=off runs planner, reasoner, verifier and generator on rules
    PORT = int(os.getenv("PORT", "3001"))
    AGENTS_BASE_URL = os.getenv("AGENTS_BASE_URL", "http://localhost:3001").rstrip("/")
    REGISTRY_URL = os.getenv("REGISTRY_URL", "http://localhost:3002").rstrip("/")
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://sworn:sworn@localhost:5432/sworn")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    WIKI_CONTACT = os.getenv("WIKI_CONTACT", "contact not set")
    TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")  # set it to search the web as well as Wikipedia
    WEB = bool(os.getenv("TAVILY_API_KEY"))


# What the user picks per run. Length: the answer's word range. Reasoning: sub-questions researched, claims kept per
# sub-question and how hard the model thinks; light is fastest, high takes longer and explains more.
LENGTHS = {"short": (60, 100), "medium": (150, 300), "long": (350, 500)}
REASONING = {
    "light": {"subquestions": 2, "claims": 3, "effort": "low"},
    "standard": {"subquestions": CONFIG.SUBQUESTIONS, "claims": 5, "effort": "low"},
    "high": {"subquestions": 4, "claims": 7, "effort": "medium"},
}

# OASF skills each role is discovered by (slugs must be in the 8004-solana SDK's getAllSkills() list).
ROLE_SKILLS = {
    "planner": ["natural_language_processing/analytical_reasoning/problem_solving"],
    "retriever": ["natural_language_processing/information_retrieval_synthesis/search"],
    "reader": ["natural_language_processing/information_retrieval_synthesis/fact_extraction"],
    "reasoner": ["natural_language_processing/analytical_reasoning/inference_deduction"],
    "verifier": ["natural_language_processing/analytical_reasoning/fact_verification"],
    "generator": ["natural_language_processing/natural_language_generation/summarization"],
}
ROLES = list(ROLE_SKILLS)

# Our agents. name is the stable ID: it is in each agent's URL, which is what is registered on-chain, so it never changes.
# title is what people see (the registration file's name). Handlers live in app/agents.py; app/register.py puts them on-chain.
AGENT_LIST = [
    {"name": "planner-a", "title": "Question Planner", "role": "planner", "description": "Splits a research question into the sub-questions it needs, each with a focused search query."},
    {"name": "retriever-a", "title": "Source Finder", "role": "retriever", "description": "Fetches the Wikipedia articles most relevant to a sub-question."},
    {"name": "retriever-b", "title": "Source Finder (2)", "role": "retriever", "description": "Backup retriever: fetches relevant Wikipedia articles."},
    {"name": "reader-a", "title": "Fact Extractor", "role": "reader", "description": "Reads source pages and extracts the sentences that bear on a sub-question, each with its source URL."},
    {"name": "reasoner-a", "title": "Claim Builder", "role": "reasoner", "description": "Turns extracted facts into short claims that answer the sub-question, keeping each claim's exact quote."},
    {"name": "verifier-a", "title": "Fact Checker", "role": "verifier", "description": "Checks that a quote is on its source page and that it supports the claim."},
    {"name": "generator-a", "title": "Answer Writer", "role": "generator", "description": "Writes the final answer from verified claims only, citing each claim ID."},
    {"name": "bad-liar", "title": "Fake-Quote Bot", "role": "reasoner", "description": "Research reasoner."},   # invents quotes: must fail the trial
    {"name": "bad-slow", "title": "Slow Bot", "role": "retriever", "description": "Research retriever."},  # never answers in time: must time out
]


def agent_url(name: str) -> str:
    return f"{CONFIG.AGENTS_BASE_URL}/agents/{name}"
