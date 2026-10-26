// Fixed-team baseline vs our system on the same questions.
// Baseline: retriever-a and bad-liar take turns on sub-questions, writer-a writes. No trials, no verification.
// Both sides are graded the same way: a claim used in the answer counts as supported only if its quote is on its source page.
import fs from 'node:fs';
import { agentUrl, CONFIG } from './config.js';
import { post, planQuestion, run, citedIds } from './orchestrator.js';
import { sourceText, quoteIn } from './sources.js';

const questions = JSON.parse(fs.readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));
const TEAM = ['retriever-a', 'bad-liar'];

const isSupported = async c => quoteIn(await sourceText(c.source_url).catch(() => ''), c.quote);

async function baseline(question) {
  const plan = await planQuestion(question);
  const claims = [];
  for (const [i, sub_question] of plan.entries()) {
    const name = TEAM[i % TEAM.length];
    const out = await post(agentUrl(name), { task_id: `t${i + 1}`, role: 'retriever', input: { sub_question } }, CONFIG.TASK_TIMEOUT_MS).catch(() => null);
    for (const c of out?.claims ?? []) claims.push({ id: `c${claims.length + 1}`, ...c });
  }
  if (!claims.length) return { used: [], answer: '' };
  const out = await post(agentUrl('writer-a'), { task_id: 'w1', role: 'writer', input: { question, claims: claims.map(({ id, text }) => ({ id, text })) } }, CONFIG.TASK_TIMEOUT_MS);
  const cited = new Set(citedIds(out.answer));
  return { used: claims.filter(c => cited.has(c.id)), answer: out.answer };
}

async function score(used) {
  const ok = (await Promise.all(used.map(isSupported))).filter(Boolean).length;
  return { used: used.length, unsupported: used.length - ok };
}

const rows = [];
for (const q of questions) {
  console.log(`\n${q}`);
  const b = await score((await baseline(q)).used);
  const ours = await run(q, { feedback: false, log: () => {}, latest: false });
  const usedIds = new Set(citedIds(ours.answer));
  const o = await score(ours.claims.filter(c => usedIds.has(c.id)));
  rows.push({ question: q, baseline_used: b.used, baseline_unsupported: b.unsupported, ours_used: o.used, ours_unsupported: o.unsupported, ours_run: ours.run_id });
  console.log(`  baseline: ${b.unsupported}/${b.used} unsupported   ours: ${o.unsupported}/${o.used} unsupported`);
}

const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
const pct = (bad, all) => (all ? Math.round((100 * bad) / all) : 0);
const summary = {
  baseline_unsupported_pct: pct(sum('baseline_unsupported'), sum('baseline_used')),
  ours_unsupported_pct: pct(sum('ours_unsupported'), sum('ours_used')),
};
console.table(rows.map(({ ours_run, ...r }) => r));
console.table(summary);
fs.writeFileSync(new URL('../runs/compare.json', import.meta.url), JSON.stringify({ rows, summary }, null, 2));
