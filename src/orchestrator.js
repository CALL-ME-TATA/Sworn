// The main agent: plan -> hire -> retrieve -> verify -> write -> report -> feedback.
// Usage: npm run run -- "your question" [--kill] [--kill=retriever-a] [--no-feedback]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIG, ROLES } from './config.js';
import { ask } from './llm.js';
import { discover, isAlive, getScore, giveFeedback, registryStats } from './registry.js';
import { makeTrial } from './trials.js';
import * as rules from './rules.js';

const RUNS = new URL('../runs/', import.meta.url);

// hard = the agent is down (unreachable, 5xx, timeout); soft = it answered badly.
class AgentError extends Error {
  constructor(message, hard) {
    super(message);
    this.hard = hard;
  }
}

const SHAPES = {
  retriever: o => Array.isArray(o?.claims) && o.claims.every(c => c?.text && c.source_url && c.quote),
  verifier: o => ['supported', 'unsupported', 'unreachable'].includes(o?.verdict),
  writer: o => typeof o?.answer === 'string' && o.answer.trim().length > 0,
};

export async function post(endpoint, body, timeoutMs) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AgentError(err.name === 'TimeoutError' ? 'timeout' : 'unreachable', true);
  }
  if (res.status >= 500 || res.status === 404) throw new AgentError(`HTTP ${res.status}`, true);
  if (!res.ok) throw new AgentError(`HTTP ${res.status}`, false);
  const json = await res.json().catch(() => null);
  if (!json) throw new AgentError('reply is not JSON', false);
  return json.output;
}

export async function planQuestion(question) {
  if (!CONFIG.LLM) return rules.plan(question, CONFIG.SUBQUESTIONS);
  const { subquestions = [] } = await ask(
    `Split this research question into at most ${CONFIG.SUBQUESTIONS} short, self-contained sub-questions, ` +
    `each answerable from an encyclopedia.\nQuestion: ${question}\nReply with JSON only: {"subquestions":["..."]}`,
    { json: true },
  );
  if (!subquestions.length) throw new Error('planner returned no sub-questions');
  return subquestions.slice(0, CONFIG.SUBQUESTIONS);
}

export const citedIds = answer => [...answer.matchAll(/\[(c\d+)\]/g)].map(m => m[1]);

export async function run(question, { feedback = true, kill = null, log = console.log, latest = true } = {}) {
  const runId = `run_${Date.now()}`;
  const reportUrl = `${CONFIG.AGENTS_BASE_URL}/runs/${runId}.json`;
  const r = {
    run_id: runId, question, started_at: new Date().toISOString(), mode: CONFIG.LLM ? `llm (${CONFIG.MODEL})` : 'rule-based',
    registry: null, plan: [], hiring: [], team: {}, claims: [], answer: null,
    failovers: [], feedback: [], metrics: {},
  };
  const save = () => {
    fs.writeFileSync(new URL(`${runId}.json`, RUNS), JSON.stringify(r, null, 2));
    if (latest) fs.writeFileSync(new URL('latest.json', RUNS), JSON.stringify(r, null, 2));
  };
  const logFile = new URL(`${runId}.log`, RUNS);
  const trace = (agent, role, taskId, ok, ms, note = '') =>
    fs.appendFileSync(logFile, `${new Date().toISOString()}\t${agent.name}\t${agent.asset}\t${role}\t${taskId}\t${ok ? 'ok' : 'fail'}\t${ms}ms\t${note}\n`);

  // Per-agent record for feedback: tasks done, failures, unsupported claims.
  const stats = new Map();
  const touch = (agent, role) => {
    if (!stats.has(agent.asset)) {
      stats.set(agent.asset, { name: agent.name, role, endpoint: agent.endpoint, ours: agent.ours, ok: 0, fail: 0, streak: 0, claims: 0, unsupported: 0, outcome: 'passed' });
    }
    return stats.get(agent.asset);
  };

  // ---------- hire ----------
  async function screen(agent, role) {
    const entry = { asset: agent.asset, name: agent.name, role, ours: agent.ours, stage: 'reputation', result: 'checking', reason: null, score: null };
    r.hiring.push(entry);
    const reject = (stage, reason, outcome) => {
      Object.assign(entry, { stage, result: 'failed', reason });
      if (outcome) Object.assign(touch(agent, role), { outcome, fail: 1 }); // we interacted, so it gets feedback
      return null;
    };

    const rep = await getScore(agent.asset);
    entry.score = rep?.average ?? null;
    entry.ratings = rep?.count ?? 0;
    if (rep && rep.count >= CONFIG.MIN_FEEDBACKS && rep.average < CONFIG.MIN_SCORE) {
      return reject('reputation', `average score ${rep.average} over ${rep.count} ratings`);
    }

    entry.stage = 'alive';
    if (!(await isAlive(agent))) return reject('alive', 'endpoint not responding', 'dead');

    entry.stage = 'trial';
    const started = Date.now();
    try {
      const trial = await makeTrial(role);
      const call = (input, i = 0) => post(agent.endpoint, { run_id: runId, task_id: `trial-${i}`, role, input }, CONFIG.TRIAL_TIMEOUT_MS);
      const out = trial.inputs ? await Promise.all(trial.inputs.map(call)) : await call(trial.input);
      const grade = await trial.grade(out);
      if (!grade.pass) return reject('trial', grade.reason, 'trial-failed');
    } catch (err) {
      return reject('trial', err.message, err.message === 'timeout' ? 'timeout' : 'trial-failed');
    }
    Object.assign(entry, { stage: 'hired', result: 'passed' });
    return { agent, score: entry.score, ms: Date.now() - started };
  }

  async function hire(role) {
    const candidates = await discover(role);
    log(`${role}: ${candidates.length} candidates (${candidates.filter(c => !c.ours).length} third-party)`);
    const passed = (await Promise.all(candidates.map(c => screen(c, role).finally(save)))).filter(Boolean);
    passed.sort((a, b) => (b.score ?? 50) - (a.score ?? 50) || a.ms - b.ms);
    return passed.map(p => p.agent);
  }

  // ---------- calls with failover ----------
  const team = {};
  const dead = new Set();
  let pendingFailover = null;

  async function callRole(role, input, taskId, { exclude } = {}) {
    for (;;) {
      const agent = team[role].find(a => !dead.has(a.asset) && a.asset !== exclude);
      if (!agent) throw new Error(`no working ${role} left`);
      const s = touch(agent, role);
      const started = Date.now();
      try {
        const out = await post(agent.endpoint, { run_id: runId, task_id: taskId, role, input }, CONFIG.TASK_TIMEOUT_MS);
        if (!SHAPES[role](out)) throw new AgentError('wrong reply shape', false);
        s.ok++;
        s.streak = 0;
        trace(agent, role, taskId, true, Date.now() - started);
        if (pendingFailover) {
          r.failovers.push({ ...pendingFailover, to: agent.asset, to_name: agent.name, took_ms: Date.now() - pendingFailover.since });
          log(`  ${agent.name} took over ${taskId} after ${Date.now() - pendingFailover.since} ms`);
          pendingFailover = null;
          save();
        }
        return { agent, out };
      } catch (err) {
        s.fail++;
        s.streak++;
        trace(agent, role, taskId, false, Date.now() - started, err.message);
        if (err.hard || s.streak >= CONFIG.BREAKER_FAILS) {
          dead.add(agent.asset);
          r.dead = [...dead];
          s.outcome = err.message === 'timeout' ? 'timeout' : 'dead';
          pendingFailover ??= { from: agent.asset, from_name: agent.name, task_id: taskId, reason: err.message, since: started };
          log(`  ${agent.name} failed (${err.message}), marked dead`);
        }
      }
    }
  }

  // ---------- the run ----------
  r.registry = await registryStats().catch(() => null);
  r.plan = await planQuestion(question);
  log(`plan: ${r.plan.join(' | ')}`);
  save();

  let killed = null; // the agent the --kill demo took offline; always revived before the run ends

  // Anything that stops the run still falls through to feedback, so screening results reach the registry.
  try {
    for (const role of ROLES) {
      team[role] = await hire(role);
      if (!team[role].length) throw new Error(`no trustworthy ${role} found`);
      r.team[role] = team[role].map(a => ({ asset: a.asset, name: a.name }));
      log(`${role}: hired ${team[role][0].name}, backups: ${team[role].slice(1).map(a => a.name).join(', ') || 'none'}`);
    }
    save();

    for (const [i, sub_question] of r.plan.entries()) {
      const { agent, out } = await callRole('retriever', { sub_question }, `t${i + 1}`);
      for (const c of out.claims) {
        r.claims.push({ id: `c${r.claims.length + 1}`, sub_question, text: c.text, source_url: c.source_url, quote: c.quote, produced_by: agent.asset, produced_by_name: agent.name, status: 'pending' });
        touch(agent, 'retriever').claims++;
      }
      save();
      if (kill && i === 0) {
        killed = typeof kill === 'string' ? kill : agent.name;
        await fetch(`${CONFIG.AGENTS_BASE_URL}/admin/kill/${killed}`, { method: 'POST' });
        log(`  [demo] killed ${killed}`);
      }
    }

    for (const c of r.claims) {
      const { agent, out } = await callRole('verifier', { claim: c.text, source_url: c.source_url, quote: c.quote }, `v-${c.id}`, { exclude: c.produced_by });
      Object.assign(c, { status: out.verdict, reason: out.reason ?? null, verified_by: agent.asset, verified_by_name: agent.name });
      if (out.verdict !== 'supported') stats.get(c.produced_by).unsupported++;
      save();
    }

    const verified = r.claims.filter(c => c.status === 'supported');
    if (!verified.length) {
      r.answer = 'No claim survived verification, so no answer was written.';
    } else {
      const allowed = new Set(verified.map(c => c.id));
      for (let attempt = 1; attempt <= 2 && !r.answer; attempt++) {
        const { agent, out } = await callRole('writer', { question, claims: verified.map(({ id, text }) => ({ id, text })) }, `w${attempt}`);
        const cited = citedIds(out.answer);
        if (cited.length && cited.every(id => allowed.has(id))) {
          r.answer = out.answer;
          r.written_by = agent.asset;
          r.written_by_name = agent.name;
        } else {
          Object.assign(touch(agent, 'writer'), { outcome: 'bad-citations' }).fail++;
        }
      }
      r.answer ??= 'The writer did not cite verified claims correctly; no answer was accepted.';
    }
  } catch (err) {
    r.error = err.message;
    r.answer = `Run stopped: ${err.message}.`;
    log(`run stopped: ${err.message}`);
  }

  if (killed) await fetch(`${CONFIG.AGENTS_BASE_URL}/admin/revive/${killed}`, { method: 'POST' }).catch(() => {});

  // ---------- feedback ----------
  for (const [asset, s] of stats) {
    const total = s.ok + s.fail;
    let score = total ? s.ok / total : 0;
    if (s.claims) score *= (s.claims - s.unsupported) / s.claims;
    score = Math.round(score * 100);
    const outcome = s.unsupported && s.outcome === 'passed' ? 'unsupported-claims' : s.outcome;
    const item = { asset, name: s.name, role: s.role, ours: s.ours, score, outcome };
    if (feedback) {
      try {
        item.tx = await giveFeedback(asset, { score, role: s.role, outcome, endpoint: s.endpoint, reportUrl });
        log(`feedback ${s.name}: ${score} (${outcome})`);
      } catch (err) {
        item.error = err.message;
        log(`feedback ${s.name} failed: ${err.message}`);
      }
    }
    r.feedback.push(item);
  }

  // ---------- metrics ----------
  const bad = r.hiring.filter(h => h.ours && h.name.startsWith('bad-'));
  const thirdParty = r.hiring.filter(h => !h.ours);
  r.metrics = {
    claims: r.claims.length,
    claims_tagged_pct: r.claims.length ? Math.round(100 * r.claims.filter(c => c.produced_by && c.source_url && c.verified_by).length / r.claims.length) : 0,
    claims_supported: r.claims.filter(c => c.status === 'supported').length,
    bad_agents_rejected: `${bad.filter(h => h.result === 'failed').length}/${bad.length}`,
    third_party_tried: thirdParty.length,
    third_party_passed: thirdParty.filter(h => h.result === 'passed').length,
    failovers: r.failovers.length,
    failover_ms: r.failovers.length ? Math.max(...r.failovers.map(f => f.took_ms)) : null,
    feedback_written: `${r.feedback.filter(f => f.tx).length}/${r.feedback.length}`,
  };
  r.finished_at = new Date().toISOString();
  save();
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const killArg = args.find(a => a.startsWith('--kill'));
  const question = args.filter(a => !a.startsWith('--')).join(' ');
  if (!question) {
    console.error('usage: npm run run -- "your question" [--kill] [--kill=agent-name] [--no-feedback]');
    process.exit(1);
  }
  const r = await run(question, {
    feedback: !args.includes('--no-feedback'),
    kill: killArg ? (killArg.split('=')[1] || true) : null,
  });
  console.log(`\n${r.answer}\n`);
  console.table(r.metrics);
  console.log(`report: runs/${r.run_id}.json  page: ${CONFIG.AGENTS_BASE_URL}/`);
  if (r.error) process.exitCode = 1;
}
