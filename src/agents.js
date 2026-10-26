// Express server hosting all our agents (good and deliberately bad), their registration files,
// an admin kill switch for the failover demo, and the results page.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { AGENT_LIST, CONFIG } from './config.js';
import { ask } from './llm.js';
import { registrationFile } from './registry.js';
import { searchWikipedia, wikiText, wikiUrl, sourceText, quoteIn } from './sources.js';
import * as rules from './rules.js';
import { run } from './orchestrator.js';

const PAGE_CHARS = 12000; // ponytail: only the start of each page goes to the model; deeper facts are missed

async function retrieve({ sub_question }, style, count) {
  const titles = await searchWikipedia(sub_question, 2);
  const pages = await Promise.all(titles.map(async t => ({ title: t, url: wikiUrl(t), text: (await wikiText(t)).slice(0, PAGE_CHARS) })));
  if (!CONFIG.LLM) return { claims: rules.pickSentences(sub_question, pages, count) };
  const passages = pages.map((p, i) => `[${i}] ${p.title}\n${p.text}`).join('\n\n');
  const { claims = [] } = await ask(
    `Question: ${sub_question}\n\nPassages:\n${passages}\n\n` +
    `Extract up to 3 factual claims that answer the question. ${style}\n` +
    'For each claim, copy one supporting sentence word for word from a passage as "quote".\n' +
    'Reply with JSON only: {"claims":[{"text":"...","quote":"...","source":<passage number>}]}',
    { json: true },
  );
  // An honest agent drops anything it cannot back with a real quote.
  return {
    claims: claims
      .map(c => ({ text: c.text, quote: c.quote, source_url: pages[c.source]?.url, page: pages[c.source] }))
      .filter(c => c.page && quoteIn(c.page.text, c.quote))
      .map(({ page, ...c }) => c),
  };
}

async function verify({ claim, source_url, quote }) {
  let text;
  try {
    text = await sourceText(source_url);
  } catch (err) {
    return { verdict: 'unreachable', reason: err.message };
  }
  if (!quoteIn(text, quote)) return { verdict: 'unsupported', reason: 'quote not found on the source page' };
  const { supported, reason } = !CONFIG.LLM ? rules.supports(claim, quote) : await ask(
    `Claim: ${claim}\nQuote from the source: "${quote}"\n\n` +
    'Does the quote, on its own, support the claim? Numbers, names and dates must match.\n' +
    'Reply with JSON only: {"supported": true or false, "reason": "one short sentence"}',
    { json: true },
  );
  return { verdict: supported ? 'supported' : 'unsupported', reason };
}

async function write({ question, claims }) {
  if (!CONFIG.LLM) return { answer: rules.write(claims) };
  const list = claims.map(c => `[${c.id}] ${c.text}`).join('\n');
  const answer = await ask(
    `Question: ${question}\n\nVerified claims:\n${list}\n\n` +
    'Write a short answer (under 150 words) using only these claims. Put the claim ID in square brackets after each sentence, ' +
    'like [c1]. Do not add facts that are not in the claims. Reply with the answer text only.',
  );
  return { answer: answer.trim() };
}

const HANDLERS = {
  'retriever-a': input => retrieve(input, 'Prefer specific numbers, dates and names.', 3),
  'retriever-b': input => retrieve(input, 'Keep each claim to one short sentence.', 3),
  'verifier-a': verify,
  'writer-a': write,
  // Deliberately bad: invents a claim and a quote that is not on the page.
  'bad-liar': async ({ sub_question }) => ({
    claims: [{ text: `The answer to "${sub_question}" is 42.`, source_url: wikiUrl('42 (number)'), quote: 'Experts agree the answer is always exactly 42.' }],
  }),
  // Deliberately bad: answers long after any timeout.
  'bad-slow': async () => {
    await new Promise(r => setTimeout(r, 60000));
    return { claims: [] };
  },
};

const killed = new Set();
const app = express();
app.use(express.json({ limit: '1mb' }));

const byName = name => AGENT_LIST.find(a => a.name === name);

app.get('/agents/:name/registration.json', (req, res) => {
  const agent = byName(req.params.name);
  if (!agent) return res.status(404).json({ error: 'unknown agent' });
  res.json(registrationFile(agent));
});

app.get('/agents/:name', (req, res) => {
  const agent = byName(req.params.name);
  if (!agent) return res.status(404).json({ error: 'unknown agent' });
  if (killed.has(agent.name)) return res.status(503).json({ error: 'agent offline' });
  res.json({ name: agent.name, role: agent.role, description: agent.description });
});

app.post('/agents/:name', async (req, res) => {
  const { name } = req.params;
  if (!HANDLERS[name]) return res.status(404).json({ error: 'unknown agent' });
  if (killed.has(name)) return res.status(503).json({ error: 'agent offline' });
  const { task_id, input } = req.body ?? {};
  try {
    res.json({ task_id, output: await HANDLERS[name](input ?? {}) });
  } catch (err) {
    console.error(`${name} ${task_id}: ${err.message}`);
    res.status(500).json({ task_id, error: err.message });
  }
});

app.post('/admin/:action/:name', (req, res) => {
  const { action, name } = req.params;
  if (action === 'kill') killed.add(name);
  else if (action === 'revive') killed.delete(name);
  else return res.status(404).json({ error: 'use kill or revive' });
  console.log(`${action} ${name}`);
  res.json({ killed: [...killed] });
});

// Start a run from the results page. One at a time; the page polls /runs/latest.json for progress.
// ponytail: no auth, so anyone who can reach this server can start runs (and spend SOL on feedback).
// Fine on localhost for the demo; put it behind a token before exposing the server publicly.
let running = null;
app.get('/api/status', (req, res) => res.json({ running: Boolean(running) }));
app.post('/api/run', (req, res) => {
  const question = String(req.body?.question ?? '').trim().slice(0, 300);
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (running) return res.status(409).json({ error: 'a run is already in progress' });
  running = run(question, { kill: req.body?.kill ? true : null })
    .catch(err => console.error(`run failed: ${err.message}`))
    .finally(() => { running = null; });
  res.status(202).json({ started: true });
});

app.use('/runs', express.static(fileURLToPath(new URL('../runs', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.listen(CONFIG.PORT, err => {
  if (err) {
    console.error(`cannot listen on port ${CONFIG.PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`agents on ${CONFIG.AGENTS_BASE_URL} (port ${CONFIG.PORT})`);
});
