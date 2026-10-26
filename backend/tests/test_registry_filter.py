"""Addresses nobody else could reach are not worth a candidate slot; real public ones are."""
from app.registry import UNREACHABLE


def test_unreachable_addresses():
    for url in ["http://localhost:3000/agent", "http://127.0.0.1:8080", "http://0.0.0.0/mcp", "http://192.168.1.4/a2a",
                "https://example.com/agent", "https://myagent.com/a2a", "https://your-domain.com/mcp"]:
        assert UNREACHABLE.search(url), url
    for url in ["https://k-gov-agent-api.vercel.app/mcp", "https://api.xona-agent.com/mcp", "https://api.mimirfeeds.io/agents/COLA"]:
        assert not UNREACHABLE.search(url), url
