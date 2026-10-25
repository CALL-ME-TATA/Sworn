// Reads every SATI agent (cascade-protocol/sati, a second ERC-8004 registry on Solana) straight from the chain
// and saves the ones whose profile lists a callable endpoint to data/sati-agents.json.
// SATI agents are Token-2022 mints in one collection (group) mint; SATI's REST API was unreliable, so this
// walks the group's transactions instead. Run: npm run sati-sync
import fs from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';

const GROUP = 'satiG7i9iyFxjq23sdyeLB4ibAHf6GXCARuosGeqane';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const IPFS = ['https://w3s.link/ipfs/', 'https://dweb.link/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://ipfs.io/ipfs/'];
const OUT = new URL('../../data/sati-agents.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function loadProfile(uri) {
  const urls = !uri ? [] : uri.startsWith('ipfs://') ? IPFS.map(g => g + uri.slice(7)) : uri.startsWith('http') ? [uri] : [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
    } catch { /* try the next gateway */ }
  }
  return null;
}

// 1. Every mint touched by the group's transactions that is a member of the group.
const sigs = await conn.getSignaturesForAddress(new PublicKey(GROUP), { limit: 1000 });
const touched = new Set();
for (const s of sigs) {
  const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  for (const k of tx?.transaction.message.accountKeys ?? []) if (k.writable) touched.add(k.pubkey.toBase58());
  await sleep(250); // public devnet RPC rate limit
}
const keys = [...touched].filter(k => k !== GROUP);
const members = [];
for (let i = 0; i < keys.length; i += 100) {
  const accs = await conn.getMultipleParsedAccounts(keys.slice(i, i + 100).map(k => new PublicKey(k)));
  accs.value.forEach((a, j) => {
    if (a?.owner.toBase58() !== TOKEN_2022 || a.data?.parsed?.type !== 'mint') return;
    const ext = Object.fromEntries((a.data.parsed.info.extensions ?? []).map(e => [e.extension, e.state]));
    if (ext.tokenGroupMember?.group === GROUP) members.push({ mint: keys[i + j], name: ext.tokenMetadata?.name ?? '', uri: ext.tokenMetadata?.uri ?? '' });
  });
  await sleep(300);
}

// 2. Read each profile; keep agents with an MCP or A2A endpoint we could call.
let readable = 0;
const agents = [];
for (const m of members) {
  const file = await loadProfile(m.uri);
  if (file) readable++;
  const services = (file?.services ?? []).map(s => ({ type: String(s.name ?? s.type ?? '').toUpperCase(), url: String(s.endpoint ?? s.value ?? ''), skills: s.skills ?? [] }));
  const endpoint = services.find(s => ['A2A', 'MCP'].includes(s.type) && /^https?:\/\//.test(s.url) && !/localhost|127\.0\.0\.1/.test(s.url));
  if (endpoint) agents.push({ mint: m.mint, name: m.name, endpoint: endpoint.url, type: endpoint.type, skills: services.flatMap(s => s.skills) });
}

fs.writeFileSync(OUT, JSON.stringify({ synced_at: new Date().toISOString(), network: 'devnet', total: members.length, readable, agents }, null, 2) + '\n');
console.log(`SATI devnet: ${members.length} agents, ${readable} readable profiles, ${agents.length} with an endpoint -> data/sati-agents.json`);
