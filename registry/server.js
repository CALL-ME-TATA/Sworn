// Solana bridge: the only service that signs or reads through the 8004-solana SDK (@solana/web3.js, Anchor programs).
// The Python backend calls it over HTTP. Two wallets: OWNER registers our agents, ORCHESTRATOR writes feedback
// (an owner should not rate its own agents).
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { SolanaSDK, computeSealHash } from '8004-solana';
import { Keypair, PublicKey } from '@solana/web3.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true }); // in Docker the env comes from compose

const PORT = Number(process.env.REGISTRY_PORT || 3002);
const ALIVE_TIMEOUT_MS = 5000;
const INDEXER = 'https://8004-indexer-dev.qnt.sh/v2/graphql';

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
  const { asset, score, role, outcome, endpoint, reportUrl, fileHash } = req.body ?? {};
  if (fileHash && !/^[0-9a-f]{64}$/.test(fileHash)) return res.status(400).json({ error: 'fileHash must be 64 hex characters (SHA-256)' });
  try {
    const result = await sdk(reviewer).giveFeedback(new PublicKey(asset), {
      value: score,
      score,
      tag1: fit(role, 32),
      tag2: fit(outcome, 32),
      ...(endpoint && { endpoint: fit(endpoint, 250) }),
      ...(reportUrl && { feedbackUri: fit(reportUrl, 250) }),
      // SHA-256 of the evidence file at feedbackUri: anyone can fetch the file and check it was not changed.
      ...(fileHash && { feedbackFileHash: Buffer.from(fileHash, 'hex') }),
    });
    if (!result.success) throw new Error(result.error ?? 'feedback failed');
    res.json({ tx: result.signature });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Does this file belong to this rating? The registry stores a SEAL hash of every field of a rating, the evidence file's
// hash included. Recompute it from the rating's on-chain fields plus the given file hash and compare with the stored one.
app.get('/seal-check', async (req, res) => {
  const { asset, tx, fileHash } = req.query;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset ?? '') || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx ?? '')) {
    return res.status(400).json({ error: 'asset and tx must be base58' });
  }
  if (!/^[0-9a-f]{64}$/.test(fileHash ?? '')) return res.status(400).json({ error: 'fileHash must be 64 hex characters (SHA-256)' });
  try {
    const query = `{ feedbacks(first: 200, orderBy: createdAt, orderDirection: desc, where: {agent: "${asset}"}) {
      tag1 tag2 endpoint feedbackURI feedbackHash solana { txSignature valueRaw valueDecimals score } } }`;
    const body = await (await fetch(INDEXER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();
    if (!body.data) throw new Error(body.errors?.[0]?.message ?? body.error ?? 'indexer error');
    const f = body.data.feedbacks.find(x => x.solana?.txSignature === tx);
    if (!f) return res.json({ indexed: false }); // the indexer is usually a minute or two behind the chain
    const recomputed = computeSealHash({
      value: BigInt(f.solana.valueRaw), valueDecimals: f.solana.valueDecimals, score: f.solana.score,
      tag1: f.tag1 ?? '', tag2: f.tag2 ?? '', endpoint: f.endpoint ?? '', feedbackUri: f.feedbackURI ?? '',
      feedbackFileHash: Buffer.from(fileHash, 'hex'),
    }).toString('hex');
    const onChain = String(f.feedbackHash).replace(/^0x/, '');
    res.json({ indexed: true, match: recomputed === onChain, onChain, recomputed, feedbackUri: f.feedbackURI });
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
