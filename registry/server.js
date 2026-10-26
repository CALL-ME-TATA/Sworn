// Solana bridge: the only service that signs or reads through the 8004-solana SDK (@solana/web3.js, Anchor programs).
// The Python backend calls it over HTTP. Two wallets: OWNER registers our agents, ORCHESTRATOR writes feedback
// (an owner should not rate its own agents).
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { SolanaSDK } from '8004-solana';
import { Keypair, PublicKey } from '@solana/web3.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true }); // in Docker the env comes from compose

const PORT = Number(process.env.REGISTRY_PORT || 3002);
const ALIVE_TIMEOUT_MS = 5000;

const keypair = env => process.env[env]
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env[env])))
  : null;
const owner = keypair('OWNER_PRIVATE_KEY');
const reviewer = keypair('ORCHESTRATOR_PRIVATE_KEY');

const sdks = new Map();
function sdk(signer) {
  const key = signer?.publicKey.toBase58() ?? 'read';
  if (!sdks.has(key)) sdks.set(key, new SolanaSDK({ cluster: 'devnet', signer: signer ?? undefined }));
  return sdks.get(key);
}

// Byte-safe truncation: on-chain tags and URIs have byte limits.
const fit = (s, max) => {
  const b = Buffer.from(String(s));
  return b.length <= max ? String(s) : b.subarray(0, max).toString();
};

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/wallets', (req, res) => res.json({
  owner: owner?.publicKey.toBase58() ?? null,
  reviewer: reviewer?.publicKey.toBase58() ?? null,
}));

// sdk.isItAlive reads the agent's on-chain URI and pings its services. It refuses localhost,
// so the backend falls back to its own ping when this says "unknown".
app.get('/alive/:asset', async (req, res) => {
  try {
    const report = await sdk(null).isItAlive(new PublicKey(req.params.asset), { timeoutMs: ALIVE_TIMEOUT_MS });
    res.json({ status: report.status });
  } catch (err) {
    res.json({ status: 'unknown', error: err.message });
  }
});

// { average, count } of on-chain feedback, or null when there is none.
// minScore 0 makes the SDK average the real feedback scores; unfiltered it reads the ATOM quality score,
// which stays 0 for agents registered without ATOM.
app.get('/score/:asset', async (req, res) => {
  try {
    const s = await sdk(null).getSummary(new PublicKey(req.params.asset), 0);
    res.json(s.totalFeedbacks > 0 ? { average: Math.round(s.averageScore * 10) / 10, count: s.totalFeedbacks } : null);
  } catch {
    res.json(null);
  }
});

// Every individual rating with the wallet that gave it, so a caller can leave out ratings an operator gave its own agents.
app.get('/ratings/:asset', async (req, res) => {
  try {
    const list = await sdk(null).readAllFeedback(new PublicKey(req.params.asset), false);
    res.json(list.map(f => ({
      client: f.client.toBase58(),
      score: f.score ?? Number(f.value) / 10 ** (f.valueDecimals ?? 0),
      tag1: f.tag1, tag2: f.tag2,
    })));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/feedback', async (req, res) => {
  if (!reviewer) return res.status(503).json({ error: 'ORCHESTRATOR_PRIVATE_KEY is not set' });
  const { asset, score, role, outcome, endpoint, reportUrl } = req.body ?? {};
  try {
    const result = await sdk(reviewer).giveFeedback(new PublicKey(asset), {
      value: score,
      score,
      tag1: fit(role, 32),
      tag2: fit(outcome, 32),
      ...(endpoint && { endpoint: fit(endpoint, 250) }),
      ...(reportUrl && { feedbackUri: fit(reportUrl, 250) }),
    });
    if (!result.success) throw new Error(result.error ?? 'feedback failed');
    res.json({ tx: result.signature });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/register', async (req, res) => {
  if (!owner) return res.status(503).json({ error: 'OWNER_PRIVATE_KEY is not set' });
  try {
    const result = await sdk(owner).registerAgent(req.body.uri);
    if (!result.success || !result.asset) throw new Error(result.error ?? 'no asset returned');
    res.json({ asset: result.asset.toBase58(), signature: result.signature });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`registry bridge on port ${PORT} (owner ${owner?.publicKey.toBase58() ?? 'not set'})`));
