// One-off: register every agent in AGENT_LIST on devnet and save their assets to data/agents.json.
// The agent server must already be reachable at AGENTS_BASE_URL (registration links point to it).
import { AGENT_LIST, CONFIG } from '../src/config.js';
import { register, savedAgents, saveAgents } from '../src/registry.js';

if (/localhost|127\.0\.0\.1/.test(CONFIG.AGENTS_BASE_URL)) {
  console.warn(`Warning: AGENTS_BASE_URL is ${CONFIG.AGENTS_BASE_URL}. The registry and other people cannot reach it; deploy first for the real demo.\n`);
}

const saved = savedAgents();
for (const agent of AGENT_LIST) {
  if (saved[agent.name]) {
    console.log(`${agent.name}: already registered (${saved[agent.name].asset})`);
    continue;
  }
  const { asset, signature } = await register(agent);
  saved[agent.name] = { asset, role: agent.role, signature };
  saveAgents(saved);
  console.log(`${agent.name}: ${asset}  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}
