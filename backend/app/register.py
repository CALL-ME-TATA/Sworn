"""One-off: register every agent in AGENT_LIST on devnet (through the registry bridge) and save its asset to
data/agents.json. The backend must already serve the registration files at AGENTS_BASE_URL.
Usage: python -m app.register"""
import asyncio
import json

from .config import AGENT_LIST, CONFIG, DATA, agent_url
from .registry import bridge, saved_agents


async def main():
    if "localhost" in CONFIG.AGENTS_BASE_URL or "127.0.0.1" in CONFIG.AGENTS_BASE_URL:
        print(f"Warning: AGENTS_BASE_URL is {CONFIG.AGENTS_BASE_URL}. Other people cannot reach it; deploy first for a public demo.\n")
    saved = saved_agents()
    for agent in AGENT_LIST:
        name = agent["name"]
        if name in saved:
            print(f"{name}: already registered ({saved[name]['asset']})")
            continue
        res = await bridge("POST", "/register", json={"uri": f"{agent_url(name)}/registration.json"}, timeout=90)
        saved[name] = {"asset": res["asset"], "role": agent["role"], "signature": res["signature"]}
        (DATA / "agents.json").write_text(json.dumps(saved, indent=2) + "\n", encoding="utf-8")
        print(f"{name}: {res['asset']}  https://explorer.solana.com/tx/{res['signature']}?cluster=devnet")


if __name__ == "__main__":
    asyncio.run(main())
