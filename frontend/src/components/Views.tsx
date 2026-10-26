import { useEffect, useState } from "react";
import {
  askClarify, citedIds, deadSet, explorer, getJson, percent, progress, ROLES, roundTrip, ROUNDS, seconds, secs, sourceName, STEPS,
  type Clarify, type Compare, type Hiring, type Run, type RunSummary,
} from "@/lib/run";
import { Asset, Empty, Origin, Rating, Title, verdictTag } from "./bits";
import { Icon } from "./ui";

/* ---------- progress ---------- */

/** Round-trip stopwatch: counts up live while the run is going, then shows the recorded total. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [live]);
  return now;
}

export function Percent({ r }: { r: Run }) {
  const { pct, doing } = percent(r);
  const now = useNow(!r.finished_at);
  const color = r.error ? "bg-red" : r.finished_at ? "bg-green" : "bg-ink";
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-end justify-between gap-4">
        <span className="flex items-center gap-2 text-sm text-muted">
          {!r.finished_at && <span className="pulse size-1.5 rounded-full bg-blue" />}{doing}
        </span>
        <span className="flex items-baseline gap-5">
          <span className="text-right" title="Round trip: from asking the question to the last score written on-chain">
            <span className="eyebrow block">{r.finished_at ? "Round trip" : "Elapsed"}</span>
            <span className="font-mono text-lg text-ink">{secs(roundTrip(r, now))}</span>
          </span>
          <span className={`serif text-3xl ${r.error ? "text-red" : "text-ink"}`}>{pct}<span className="text-lg text-muted">%</span></span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Run progress">
        <div className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Steps({ r }: { r: Run }) {
  const at = progress(r);
  return (
    <ol className="m-0 grid list-none grid-cols-4 gap-x-2 gap-y-4 p-0 sm:grid-cols-8" aria-label="Run steps">
      {STEPS.map(([name, what], i) => {
        const state = i < at ? "done" : i === at ? (r.error ? "stop" : "now") : "todo";
        return (
          <li key={name} aria-current={state === "now" ? "step" : undefined}>
            <div className={`mb-2 h-[3px] rounded-full ${state === "done" ? "bg-ink" : state === "now" ? "pulse bg-blue" : state === "stop" ? "bg-red" : "bg-line"}`} />
            <p className={`m-0 text-[13px] font-medium ${state === "todo" ? "text-faint" : state === "stop" ? "text-red" : "text-ink"}`}>{name}</p>
            <p className="m-0 hidden text-xs text-muted sm:block">{state === "stop" ? "stopped here" : what}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- answer ---------- */

function stoppedHelp(err: string) {
  if (/AI provider limit/.test(err)) return "This is a limit on our side, not a fault in any agent, so nobody was scored for it. The free AI tier has per-minute and per-day token limits; Sworn already switches to a backup model when one runs out. Wait a few minutes and run again.";
  if (/no working/.test(err)) return "Every hired agent for that role failed during the run, so nobody was left to do the work. The usual cause is the AI provider's per-minute limit. Wait a minute and run again; the Hiring tab shows which agent failed and why.";
  if (/no trustworthy/.test(err)) return "No candidate passed all three checks for that role. The Hiring tab shows why each was turned away. Trials are drawn at random, so try again.";
  return "The Hiring tab shows which agent failed and why. Wait a minute and run again.";
}

export function Answer({ r }: { r: Run }) {
  if (r.error) {
    return (
      <div className="card border-red-bg p-6 sm:p-8">
        <span className="tag tag-red mb-4">stopped</span>
        <p className="m-0 text-lg text-ink">{r.answer ?? r.error}</p>
        <p className="mt-3 mb-0 text-muted">{stoppedHelp(r.error)}</p>
      </div>
    );
  }
  if (!r.answer) return <Empty>The answer appears here once the hired team has researched and checked its claims.</Empty>;
  const byId = Object.fromEntries(r.claims.map((c) => [c.id, c]));
  const names = (list: (string | undefined)[]) => [...new Set(list.filter(Boolean))].join(", ") || "—";
  // Text with [cN] citations turned into chips; "fact [c3]." reads as "fact. [c3]".
  const cited = (text: string) => text.replace(/\s*((?:\[c\d+\]\s*)+)([.,;:!?])/g, "$2 $1").split(/\s*\[(c\d+)\]/g).map((p, i) => {
    if (i % 2 === 0) return p;
    const c = byId[p];
    const tip = c ? `“${c.quote}” · ${sourceName(c.source_url)} · reasoned by ${c.produced_by_name}, checked by ${c.verified_by_name}` : p;
    return (
      <a key={i} href={`#evidence/${p}`} title={tip}
        className="mx-0.5 rounded bg-blue-bg px-1.5 py-0.5 align-[2px] font-mono text-[11px] font-medium text-blue no-underline hover:bg-ink hover:text-white">{p}</a>
    );
  });
  // Paragraphs are separated by blank lines; lines starting with "- " form a list.
  const blocks = r.answer.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const items = lines.filter((l) => /^[-•*]\s+/.test(l));
    return { lead: lines.filter((l) => !/^[-•*]\s+/.test(l)).join(" "), items: items.map((l) => l.replace(/^[-•*]\s+/, "")) };
  });
  const credits = [
    ["Planned", r.tasks[0]?.planned_by_name], ["Retrieved", names(r.tasks.map((t) => t.retrieved_by_name))],
    ["Read", names(r.tasks.map((t) => t.read_by_name))], ["Reasoned", names(r.claims.map((c) => c.produced_by_name))],
    ["Checked", names(r.claims.map((c) => c.verified_by_name))], ["Written", r.written_by_name],
  ];
  return (
    <div className="card overflow-hidden">
      <div className="max-w-[72ch] space-y-4 p-6 text-[17px] leading-[1.75] text-ink-2 sm:p-8">
        {blocks.map((b, i) => (
          <div key={i}>
            {b.lead && <p className={`m-0 ${i === 0 ? "text-[19px] leading-[1.65] text-ink" : ""}`}>{cited(b.lead)}</p>}
            {b.items.length > 0 && (
              <ul className="m-0 mt-2 space-y-1.5 pl-5 marker:text-faint">
                {b.items.map((item, j) => <li key={j}>{cited(item)}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <dl className="m-0 grid grid-cols-2 border-t border-line bg-bone/50 sm:grid-cols-3 lg:grid-cols-6">
        {credits.map(([k, v]) => (
          <div key={k} className="border-b border-line px-6 py-4 lg:border-b-0 lg:not-first:border-l">
            <dt className="eyebrow">{k} by</dt>
            <dd className="m-0 mt-1 text-sm font-medium text-ink">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Scoreline({ r }: { r: Run }) {
  const m = r.metrics;
  const stats: [string, string][] = [
    [`${m.claims_supported ?? 0}/${m.claims ?? 0}`, "claims supported"],
    [m.bad_agents_rejected ?? "-", "bad agents out"],
    [`${m.third_party_passed ?? 0}/${m.third_party_tried ?? 0}`, "outside agents passed"],
    ...(m.failover_ms != null ? [[`${(m.failover_ms / 1000).toFixed(2)} s`, "backup takeover"] as [string, string]] : []),
    [m.feedback_written ?? "-", "scores on-chain"],
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {stats.map(([n, label]) => (
        <div key={label} className="card min-w-[140px] flex-1 px-5 py-4">
          <p className="serif m-0 text-2xl">{n}</p>
          <p className="m-0 mt-1 text-xs text-muted">{label}</p>
        </div>
      ))}
    </div>
  );
}

export function ClarifyOptions({ c, question, asTyped = true, onRun }: { c: Extract<Clarify, { clear: false }>; question: string; asTyped?: boolean; onRun: (q: string) => void }) {
  return (
    <>
      <p className="serif m-0 text-2xl">{c.ask}</p>
      <p className="mt-1 mb-5 text-sm text-muted">You asked: “{question}”</p>
      <div className="grid gap-2">
        {c.options.map((o) => (
          <button key={o.question} type="button" onClick={() => onRun(o.question)}
            className="group flex items-center justify-between gap-4 rounded-lg border border-line bg-card px-4 py-3 text-left transition-colors hover:border-ink">
            <span><span className="block font-medium text-ink">{o.label}</span><span className="block text-sm text-muted">{o.question}</span></span>
            <Icon name="arrow" size={16} className="flex-none text-faint group-hover:text-ink" />
          </button>
        ))}
      </div>
      {asTyped && <button type="button" onClick={() => onRun(question)} className="mt-4 text-sm text-muted underline underline-offset-4 hover:text-ink">Run my question as typed</button>}
    </>
  );
}

/** After a run: suggestions appear on their own when nothing was found; otherwise on request. */
export function FollowUp({ r, onRun }: { r: Run; onRun: (q: string) => void }) {
  const found = r.claims.some((c) => c.status === "supported");
  const [state, setState] = useState<"idle" | "loading" | Clarify>(found ? "idle" : "loading");
  useEffect(() => {
    if (state === "loading") askClarify(r.question, true).then(setState);
  }, [state, r.question]);
  if (state === "idle") {
    return <button type="button" className="mt-6 text-sm text-muted underline underline-offset-4 hover:text-ink" onClick={() => setState("loading")}>Not what you meant? Get more specific follow-up questions</button>;
  }
  return (
    <div className="card mt-6 p-6 sm:p-8">
      {state === "loading" ? <p className="m-0 flex items-center gap-2 text-muted"><span className="pulse size-2 rounded-full bg-blue" />Finding better questions to ask…</p>
        : state.clear ? <p className="m-0 text-muted">No better phrasing found. Try naming the exact event, product or person.</p>
        : <ClarifyOptions c={state} question={r.question} asTyped={false} onRun={onRun} />}
    </div>
  );
}

/* ---------- evidence ---------- */

export function Evidence({ r, target }: { r: Run; target?: string }) {
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [target]);
  if (!r.claims.length) return <><Title>Evidence</Title><Empty>Claims appear here as the reasoner states them, each with its exact quote and source.</Empty></>;
  const used = new Set(citedIds(r.answer));
  return (
    <>
      <Title note="Every claim with the exact sentence it came from, its source, the agent that stated it and the different agent that checked it.">Evidence</Title>
      <div className="space-y-6">
        {r.tasks.map((t, gi) => {
          const rows = r.claims.filter((c) => c.sub_question === t.question);
          return (
            <section key={t.id} className="card overflow-hidden">
              <header className="border-b border-line bg-bone/50 px-6 py-4">
                <p className="eyebrow mb-1">Sub-question {gi + 1} of {r.tasks.length} · retrieved by {t.retrieved_by_name ?? "…"} · read by {t.read_by_name ?? "…"}</p>
                <p className="m-0 font-medium text-ink">{t.question}</p>
              </header>
              {rows.length ? (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {rows.map((c) => (
                    <li key={c.id} id={c.id} className={`grid gap-3 px-6 py-5 sm:grid-cols-[48px_minmax(0,1fr)_auto] ${target === c.id ? "bg-yellow-bg/60" : ""}`}>
                      <span className="font-mono text-sm text-muted">{c.id}</span>
                      <div className="min-w-0">
                        <p className="m-0 text-ink">{c.text}</p>
                        {c.quote !== c.text && <p className="mt-1.5 mb-0 border-l-2 border-line pl-3 text-sm text-muted italic">“{c.quote}”</p>}
                        <p className="mt-2 mb-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                          <a href={c.source_url} target="_blank" rel="noopener" className="font-medium text-ink-2">{sourceName(c.source_url)}</a>
                          <span>stated by {c.produced_by_name}</span><span>checked by {c.verified_by_name ?? "…"}</span>
                        </p>
                      </div>
                      <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                        <span className={`tag ${verdictTag(c.status)}`} title={c.reason ?? "not checked yet"}>{c.status}</span>
                        {r.answer && !r.error && <span className={`tag ${used.has(c.id) ? "tag-gray" : "bg-transparent text-faint"}`}>{used.has(c.id) ? "cited" : "not used"}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 px-6 py-5 text-sm text-muted">{t.reasoned_by ? "No sentence in the sources answered this part." : "Working on it…"}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ---------- hiring ---------- */

const ROUND_LABEL = { reputation: "Track record", alive: "Answers", trial: "Benchmark" } as const;

const aspectTip = (b: NonNullable<Hiring["bench"]>) =>
  `Standard benchmark ${b.version}${b.cached ? " (today's result)" : ""}: ` +
  Object.entries(b.aspects).map(([a, v]) => `${a} ${Math.round(v ?? 0)}`).join(", ") + ". Equal weights.";

function Round({ h, round }: { h: Hiring; round: (typeof ROUNDS)[number] }) {
  const order = [...ROUNDS, "hired"];
  const at = order.indexOf(h.stage), i = order.indexOf(round);
  if (round === "trial" && h.bench && (i <= at)) {
    const pass = h.stage === "hired";
    return <span className={`tag ${pass ? "tag-green" : "tag-red"}`} title={aspectTip(h.bench)}>{pass ? <Icon name="check" size={10} /> : <Icon name="x" size={10} />}{Math.round(h.bench.score)}/100</span>;
  }
  if (i < at || (i === at && h.stage === "hired")) {
    const label = round === "reputation" ? (h.score != null ? String(h.score) : "new") : round === "alive" ? "live" : "pass";
    return <span className="tag tag-green"><Icon name="check" size={10} />{label}</span>;
  }
  if (i > at) return <span className="text-faint">—</span>;
  if (h.result === "failed") return <span className="tag tag-red" title={h.reason ?? ""}><Icon name="x" size={10} />out</span>;
  if (h.result === "busy") return <span className="tag tag-yellow" title={h.reason ?? ""}>busy</span>;
  return <span className="tag tag-yellow"><span className="pulse size-1.5 rounded-full bg-yellow" />checking</span>;
}

export function HiringView({ r }: { r: Run }) {
  const dead = deadSet(r);
  return (
    <>
      <Title note="Every candidate, ours or anyone's, goes through the same three checks: its independent on-chain track record (self-ratings ignored; out below 40 after 3 ratings), whether it answers, and the standard benchmark (five equally weighted aspects, graded by code; 60/100 to be hired). Hover a benchmark score for its aspects.">Hiring</Title>
      {!r.hiring.length && <Empty>Searching the registries for candidates…</Empty>}
      <div className="space-y-6">
        {ROLES.map((role) => {
          const rows = r.hiring.filter((h) => h.role === role);
          if (!rows.length) return null;
          const team = (r.team?.[role] ?? []).map((t) => t.asset);
          const swaps = r.failovers.filter((f) => team.includes(f.from));
          return (
            <section key={role} className="card overflow-hidden">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-bone/50 px-6 py-3">
                <p className="m-0 font-medium text-ink capitalize">{role}</p>
                <p className="m-0 text-xs text-muted">{rows.length} candidate{rows.length === 1 ? "" : "s"} · {team.length} hired</p>
              </header>
              {(() => {
                const name = (h: Hiring) => (
                  <>
                    <p className={`m-0 font-medium ${h.result === "failed" || dead.has(h.asset) ? "text-muted line-through decoration-red/50" : "text-ink"}`}>{h.name}</p>
                    <p className="m-0 mt-0.5 flex flex-wrap items-center gap-2"><Origin h={h} /><Rating h={h} /><Asset asset={h.asset} /></p>
                  </>
                );
                const result = (h: Hiring) => {
                  const pos = team.indexOf(h.asset);
                  return dead.has(h.asset) ? <span className="tag tag-red">went offline</span>
                    : r.failovers.some((f) => f.to === h.asset) ? <span className="tag tag-green">took over</span>
                    : pos === 0 ? <span className="tag bg-ink text-white">hired</span>
                    : pos > 0 ? <span className="tag tag-gray">backup {pos}</span>
                    : h.result === "failed" ? <span className="text-[13px] text-red">{h.reason}</span>
                    : h.result === "busy" ? <span className="text-[13px] text-yellow">AI provider busy · not scored</span>
                    : <span className="text-faint">—</span>;
                };
                return (
                  <>
                    {/* phones: one stacked block per candidate */}
                    <ul className="m-0 list-none divide-y divide-line p-0 sm:hidden">
                      {rows.map((h) => (
                        <li key={`${h.asset}-${role}`} className="space-y-2 px-5 py-4">
                          <div>{name(h)}</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted">
                            {ROUNDS.map((x) => <span key={x} className="flex items-center gap-1.5">{ROUND_LABEL[x]} <Round h={h} round={x} /></span>)}
                          </div>
                          <div>{result(h)}</div>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden px-6 sm:block">
                      <table className="tbl">
                        <thead><tr><th>Candidate</th>{ROUNDS.map((x) => <th key={x}>{ROUND_LABEL[x]}</th>)}<th>Result</th></tr></thead>
                        <tbody>
                          {rows.map((h) => (
                            <tr key={`${h.asset}-${role}`}>
                              <td>{name(h)}</td>
                              {ROUNDS.map((x) => <td key={x}><Round h={h} round={x} /></td>)}
                              <td>{result(h)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
              {swaps.map((s) => (
                <p key={s.from} className="m-0 flex flex-wrap items-center gap-2 border-t border-line px-6 py-3 text-sm">
                  <Icon name="swap" size={16} className="text-yellow" />
                  <span className="text-muted line-through">{s.from_name}</span><Icon name="arrow" size={13} className="text-faint" /><span className="font-medium text-ink">{s.to_name}</span>
                  <span className="text-muted">{s.reason} on {s.task_id} · took over in {(s.took_ms / 1000).toFixed(2)} s</span>
                </p>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ---------- on-chain record ---------- */

export function Record({ r }: { r: Run }) {
  if (!r.feedback.length) return <><Title>On-chain record</Title><Empty>When the run ends, every agent&apos;s score is written to the Solana Agent Registry and listed here with its transaction.</Empty></>;
  return (
    <>
      <Title note="Each agent's score, written to the Solana Agent Registry by the orchestrator's wallet. Open any transaction to check it yourself.">On-chain record</Title>
      <div className="card overflow-x-auto px-6 py-2">
        <table className="tbl min-w-[560px]">
          <thead><tr><th>Agent</th><th>Role</th><th>Score</th><th>Outcome</th><th>Transaction</th></tr></thead>
          <tbody>
            {r.feedback.map((f) => (
              <tr key={`${f.asset}-${f.role}`}>
                <td><span className="font-medium text-ink">{f.name}</span> <Asset asset={f.asset} /></td>
                <td className="text-muted capitalize">{f.role}</td>
                <td className="font-mono text-ink">{f.score}</td>
                <td><span className={`tag ${f.outcome === "passed" ? "tag-green" : "tag-red"}`}>{f.outcome}</span></td>
                <td>{f.tx ? <a href={explorer("tx", f.tx)} target="_blank" rel="noopener" className="font-mono text-xs">{f.tx.slice(0, 10)}…</a> : <span className="text-xs text-muted">{f.error ?? "not sent"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 mb-0 max-w-2xl text-sm text-muted">
        Validation records (each claim, who stated it, who checked it, the verdict) are stored in Postgres at{" "}
        <a href={`/api/runs/${r.run_id}/validations`} target="_blank" rel="noopener" className="inline-code no-underline">/api/runs/{r.run_id}/validations</a>.
        Every on-chain entry links back to this run&apos;s report.
      </p>
    </>
  );
}

/* ---------- registries ---------- */

function Bar({ label, n, total, children }: { label: string; n: number; total: number; children: React.ReactNode }) {
  const pct = (100 * n) / total;
  return (
    <div className="card p-6 sm:p-8">
      <p className="eyebrow mb-3">{label}</p>
      <p className="serif m-0 text-5xl">{n} <span className="text-2xl text-muted">of {total.toLocaleString()}</span></p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-bone"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(pct, 0.6)}%` }} /></div>
      <p className="mt-4 mb-0 text-sm text-muted">{children}</p>
    </div>
  );
}

export function Registries({ r }: { r: Run }) {
  const g = r.registry;
  if (!g) return <><Title>The open registries</Title><Empty>Reading the registries…</Empty></>;
  return (
    <>
      <Title note="Solana devnet, read at the start of this run.">The open registries</Title>
      <div className="grid gap-4 md:grid-cols-2">
        <Bar label="Solana Agent Registry (8004)" n={g.with_endpoint} total={g.total}>
          Agents with an endpoint you can call at all ({((100 * g.with_endpoint) / g.total).toFixed(1)}%). {g.with_profile.toLocaleString()} have a readable profile and {g.with_skills} declare any skills.
        </Bar>
        {g.sati && (
          <Bar label="SATI registry" n={g.sati.with_endpoint} total={g.sati.total}>
            Agents whose profile lists an MCP or A2A endpoint. {g.sati.with_profile} of {g.sati.total} profiles could be read. Most endpoints are template placeholders, so every candidate is screened.
          </Bar>
        )}
      </div>
    </>
  );
}

/* ---------- baseline ---------- */

export function Baseline({ compare }: { compare: Compare | null }) {
  if (!compare) return <><Title>Fixed team vs Sworn</Title><Empty>No comparison yet. Run <code className="inline-code">python -m app.baseline</code> to compare.</Empty></>;
  const sum = (k: "baseline_used" | "baseline_unsupported" | "ours_used" | "ours_unsupported") => compare.rows.reduce((n, x) => n + x[k], 0);
  const team = (label: string, used: number, bad: number, ours: boolean, how: string) => {
    const pct = used ? Math.round((100 * bad) / used) : 0;
    return (
      <div className="card p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="m-0 font-medium text-ink">{label}</p>
          <span className={`tag ${ours ? "tag-green" : "tag-red"}`}>{pct}% unsupported</span>
        </div>
        <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-bone" role="img" aria-label={`${bad} of ${used} claims unsupported`}>
          <div className="bg-ink" style={{ width: `${100 - pct}%` }} /><div className="bg-red" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-4 mb-0 text-sm text-muted">{used - bad} of {used} claims in its answers were backed by their source; <span className="text-ink">{bad} were not</span>. {how}</p>
      </div>
    );
  };
  return (
    <>
      <Title note={`Same ${compare.rows.length} questions, same agents, same grading${compare.mode ? ` · ${compare.mode}` : ""}. A claim is unsupported when its quote is not on the page it cites.`}>Fixed team vs Sworn</Title>
      <div className="grid gap-4 md:grid-cols-2">
        {team("Fixed team", sum("baseline_used"), sum("baseline_unsupported"), false, "A hardcoded team with one bad agent, no screening, no checking.")}
        {team("Sworn", sum("ours_used"), sum("ours_unsupported"), true, "Every agent screened before hiring, every claim checked by a second agent.")}
      </div>
      <div className="card mt-4 overflow-x-auto px-6 py-2">
        <table className="tbl min-w-[520px]">
          <thead><tr><th>Question</th><th>Fixed team</th><th>Sworn</th></tr></thead>
          <tbody>
            {compare.rows.map((x) => (
              <tr key={x.question}>
                <td className="text-ink">{x.question}</td>
                <td className={x.baseline_unsupported ? "text-red" : "text-muted"}>{x.baseline_unsupported} of {x.baseline_used} unsupported</td>
                <td className={x.ours_unsupported ? "text-red" : "text-muted"}>{x.ours_unsupported} of {x.ours_used} unsupported</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- history ---------- */

export function History({ current, onPick }: { current?: string; onPick: (id: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  useEffect(() => { getJson<RunSummary[]>("/api/runs?limit=30").then(setRuns); }, []);
  if (!runs) return <><Title>History</Title><Empty>Loading past runs…</Empty></>;
  return (
    <>
      <Title note="Every run is stored in Postgres with its full report.">History</Title>
      <div className="card divide-y divide-line">
        {runs.map((x) => (
          <button key={x.id} type="button" onClick={() => onPick(x.id)}
            className={`flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-4 text-left transition-colors hover:bg-bone/60 ${x.id === current ? "bg-bone/60" : ""}`}>
            <span className="min-w-0 flex-1 text-ink">{x.question}</span>
            <span className="flex items-center gap-3 text-xs text-muted">
              {x.error ? <span className="tag tag-red">stopped</span> : <span className="tag tag-green">{x.supported ?? 0}/{x.claims ?? 0} supported</span>}
              <span>{x.finished_at ? `${seconds(x.started_at, x.finished_at)} s` : "running"}</span>
              <span className="hidden sm:inline">{new Date(x.started_at).toLocaleString()}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
