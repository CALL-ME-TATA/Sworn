// Everything that touches Solana: register, discover(role), isAlive, getScore, giveFeedback.
// Two wallets: OWNER registers our agents, ORCHESTRATOR writes feedback (owners should not rate their own agents).
import fs from 'node:fs';
import { SolanaSDK, buildRegistrationFileJson, ServiceType } from '8004-solana';
import { Keypair, PublicKey } from '@solana/web3.js';
import { CONFIG, ROLE_SKILLS, AGENT_LIST, agentUrl } from './config.js';

const AGENTS_FILE = new URL('../data/agents.json', import.meta.url);

const keypair = env => process.env[env]
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env[env])))
  : null;

export const owner = keypair('OWNER_PRIVATE_KEY');
export const reviewer = keypair('ORCHESTRATOR_PRIVATE_KEY');

const sdks = new Map();
function sdk(signer) {
  const key = signer?.publicKey.toBase58() ?? 'read';
  if (!sdks.has(key)) sdks.set(key, new SolanaSDK({ cluster: 'devnet', signer: signer ?? undefined }));
  return sdks.get(key);
}

// ---------- identity ----------

export function registrationFile({ name, role, description }) {
  const endpoint = agentUrl(name);
  return buildRegistrationFileJson({
    name,
    description,
    services: [
      { type: ServiceType.A2A, value: endpoint },
      { type: ServiceType.OASF, value: `${endpoint}/registration.json` }, // the SDK puts skills on this entry
    ],
    skills: ROLE_SKILLS[role],
  });
}

export async function register(agent) {
  if (!owner) throw new Error('OWNER_PRIVATE_KEY is not set (run npm run keygen)');
  const result = await sdk(owner).registerAgent(`${agentUrl(agent.name)}/registration.json`);
  if (!result.success || !result.asset) throw new Error(`register ${agent.name} failed: ${result.error ?? 'no asset returned'}`);
  return { asset: result.asset.toBase58(), signature: result.signature };
}

export const savedAgents = () => fs.existsSync(AGENTS_FILE) ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) : {};
export const saveAgents = agents => fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2) + '\n');

// ---------- discovery ----------

async function gql(query, variables = {}) {
  const res = await fetch(CONFIG.INDEXER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`indexer: ${body.errors[0].message}`);
  return body.data;
}

const AGENT_FIELDS = 'id owner agentURI registrationFile { name active a2aEndpoint mcpEndpoint oasfSkills }';

let allAgents;
// Every agent on devnet, 250 per page (the indexer's cap). Cached for the process.
export async function listAgents() {
  if (allAgents) return allAgents;
  const out = [];
  for (let skip = 0; ; skip += 250) {
    const { agents } = await gql(`query($skip: Int) { agents(first: 250, skip: $skip, orderBy: createdAt, orderDirection: desc) { ${AGENT_FIELDS} } }`, { skip });
    out.push(...agents);
    if (agents.length < 250) break;
  }
  return (allAgents = out);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.ALIVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Our agents: owned by OWNER, profile read straight from its registration file (the indexer can lag).
async function ourCandidates(all) {
  const ownerKey = owner?.publicKey.toBase58();
  let mine = all.filter(a => a.owner === ownerKey).map(a => ({ asset: a.id, uri: a.agentURI }));
  if (!mine.length) {
    // Fallback: the indexer has not caught up yet, use what register.js saved.
    mine = Object.entries(savedAgents()).map(([name, a]) => ({ asset: a.asset, uri: `${agentUrl(name)}/registration.json` }));
  }
  if (!mine.length) {
    // Local dev before registration: no on-chain asset yet, so reputation and feedback are skipped for these.
    mine = AGENT_LIST.map(a => ({ asset: `unregistered:${a.name}`, uri: `${agentUrl(a.name)}/registration.json` }));
  }
  const profiles = await Promise.all(mine.map(async m => {
    const file = await fetchJson(m.uri).catch(() => null);
    if (!file) return null;
    const svc = type => file.services?.find(s => s.name === type);
    return { asset: m.asset, name: file.name, endpoint: svc('A2A')?.endpoint, skills: svc('OASF')?.skills ?? [], ours: true };
  }));
  return profiles.filter(p => p?.endpoint);
}

// Candidates for a role: our agents whose skills match, plus third-party agents that declare the skill.
// Retrievers also get a few third-party agents that have any endpoint, so real registry agents are tested.
export async function discover(role) {
  const all = await listAgents();
  const wanted = ROLE_SKILLS[role];
  const matches = skills => (skills ?? []).some(s => wanted.includes(s));
  const ours = (await ourCandidates(all)).filter(c => matches(c.skills));

  const ownerKey = owner?.publicKey.toBase58();
  const theirs = all
    .filter(a => a.owner !== ownerKey && a.registrationFile?.a2aEndpoint)
    .map(a => ({ asset: a.id, name: a.registrationFile.name ?? a.id.slice(0, 8), endpoint: a.registrationFile.a2aEndpoint, skills: a.registrationFile.oasfSkills ?? [], ours: false }));
  const extra = role === 'retriever' ? theirs.filter(t => !matches(t.skills)).slice(0, CONFIG.THIRD_PARTY_RETRIEVERS) : [];

  return [...ours, ...theirs.filter(t => matches(t.skills)), ...extra].slice(0, CONFIG.MAX_CANDIDATES);
}

// How many devnet agents can be called at all (shown in the demo).
export async function registryStats() {
  const all = await listAgents();
  return {
    total: all.length,
    with_profile: all.filter(a => a.registrationFile?.name).length,
    with_endpoint: all.filter(a => a.registrationFile?.a2aEndpoint || a.registrationFile?.mcpEndpoint).length,
    with_skills: all.filter(a => a.registrationFile?.oasfSkills?.length).length,
  };
}

// ---------- liveness and reputation ----------

async function ping(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(CONFIG.ALIVE_TIMEOUT_MS) });
    return res.ok || [401, 402, 403, 405].includes(res.status);
  } catch {
    return false;
  }
}

// sdk.isItAlive reads the on-chain URI and pings every service; it refuses localhost,
// so during local runs we fall back to pinging the endpoint ourselves.
export async function isAlive(candidate) {
  try {
    const report = await sdk(null).isItAlive(new PublicKey(candidate.asset), { timeoutMs: CONFIG.ALIVE_TIMEOUT_MS });
    if (report.status !== 'not_live') return true;
  } catch { /* fall through to our own ping */ }
  return ping(candidate.endpoint);
}

// { average, count } of on-chain feedback, or null when the agent has none (or no on-chain asset yet).
export async function getScore(asset) {
  try {
    // minScore 0 makes the SDK average the real feedback scores; unfiltered it reads the ATOM quality score,
    // which stays 0 for agents registered without ATOM.
    const s = await sdk(null).getSummary(new PublicKey(asset), 0);
    return s.totalFeedbacks > 0 ? { average: Math.round(s.averageScore * 10) / 10, count: s.totalFeedbacks } : null;
  } catch {
    return null;
  }
}

// ---------- feedback ----------

const fit = (s, max) => {
  const b = Buffer.from(String(s));
  return b.length <= max ? String(s) : b.subarray(0, max).toString();
};

export async function giveFeedback(asset, { score, role, outcome, endpoint, reportUrl }) {
  if (!reviewer) throw new Error('ORCHESTRATOR_PRIVATE_KEY is not set (run npm run keygen)');
  const result = await sdk(reviewer).giveFeedback(new PublicKey(asset), {
    value: score,
    score,
    tag1: fit(role, 32),
    tag2: fit(outcome, 32),
    ...(endpoint && { endpoint: fit(endpoint, 250) }),
    ...(reportUrl && { feedbackUri: fit(reportUrl, 250) }),
  });
  if (!result.success) throw new Error(result.error ?? 'feedback failed');
  return result.signature;
}
