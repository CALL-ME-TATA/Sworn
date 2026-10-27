"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark, Icon } from "@/components/ui";
import { Benchmarks } from "@/components/Benchmarks";
import { Trust } from "@/components/Trust";
import { FailoverRecord, Timing } from "@/components/Timing";
import { Answer, ClarifyOptions, Evidence, FollowUp, HiringView, History, InspectorView, Percent, PlanView, Record, Scoreline, SourcesView, Steps, ValidationsView } from "@/components/Views";
import { askClarify, getJson, LENGTHS, postJson, REASONINGS, seconds, type Clarify, type Length, type Reasoning, type Run } from "@/lib/run";

/** A small segmented radio group: one choice of a few, each with a short hint underneath its label. */
function Choice<T extends string>({ name, label, options, value, onChange }: {
  name: string; label: string; value: T; onChange: (v: T) => void;
  options: { id: T; label: string; hint: string; about: string }[];
}) {
  return (
    <fieldset className="flex items-center gap-2.5">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden className="w-16 text-xs text-faint sm:w-auto">{label}</span>
      <span className="inline-flex rounded-md border border-line bg-bone p-0.5">
        {options.map((o) => (
          <label key={o.id} title={o.about}
            className={`flex cursor-pointer flex-col items-center rounded px-2.5 py-1 leading-tight transition-colors select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${value === o.id ? "bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-ink"}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" />
            <span className="text-[13px] font-medium">{o.label}</span>
            <span className="font-mono text-[10px] whitespace-nowrap text-faint">{o.hint}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

const EXAMPLES = [
  "How was penicillin discovered and why did it matter?",
  "What is the typical price of a 32 GB laptop RAM module?",
  "What causes coral bleaching and where has it happened?",
];

type ClarifyBox = null | "checking" | { c: Extract<Clarify, { clear: false }>; question: string };

function useHash() {
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(location.hash.slice(1));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return hash;
}

export default function App() {
  const [run, setRun] = useState<Run | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string | null>(null); // run_id we just started; hide until that report appears
  const [viewing, setViewing] = useState<string | null>(null);       // a past run picked from History
  const [question, setQuestion] = useState("");
  const [kill, setKill] = useState(false);
  const [length, setLength] = useState<Length>("medium");
  const [reasoning, setReasoning] = useState<Reasoning>("standard");
  const [clarify, setClarify] = useState<ClarifyBox>(null);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const hash = useHash();

  const load = useCallback(async () => {
    const [status, r] = await Promise.all([
      getJson<{ running: boolean }>("/api/status"),
      getJson<Run>(viewing ? `/api/runs/${viewing}` : "/api/runs/latest"),
    ]);
    setRunning(Boolean(status?.running));
    setLoaded(true);
    if (r && waitingFor && r.run_id === waitingFor) setWaitingFor(null);
    if (r) setRun(r);
    // No report (backend restarting, or no runs yet) also keeps polling, so the page recovers on its own.
    return { busy: Boolean(status?.running) || Boolean(waitingFor) || !r || !r.finished_at };
  }, [viewing, waitingFor]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const { busy } = await load();
      if (alive && busy && !viewing) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [load, viewing]);


  async function startRun(q: string) {
    setClarify(null);
    setQuestion(q);
    setViewing(null);
    const res = await postJson("/api/run", { question: q, kill, length, reasoning, source: "web" });
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({})))?.detail ?? `Could not start the run (HTTP ${res.status}). Is the backend running?`);
      return;
    }
    const body = await res.json().catch(() => ({}));
    setNotice("");
    setWaitingFor(body.run_id ?? run?.run_id ?? "none");
    history.replaceState(null, "", location.pathname); // a new run starts on its default tab
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  // Check the question first; only an unclear question stops to ask.
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || running) return;
    setClarify("checking");
    const c = await askClarify(q, false);
    if (c.clear) return startRun(q);
    setClarify({ c, question: q });
  }

  const [tabId, claimTarget] = hash.split("/");
  const r = waitingFor ? null : run;
  const done = Boolean(r?.finished_at);
  const tabs = r ? [
    { id: "answer", label: "Answer" },
    { id: "plan", label: "Plan", count: r.tasks.length || null },
    { id: "sources", label: "Sources", count: r.tasks.reduce((n, t) => n + (t.sources?.length ?? 0), 0) || null },
    { id: "evidence", label: "Evidence", count: r.claims.length || null },
    { id: "hiring", label: "Hiring", count: r.hiring.length || null },
    { id: "trust", label: "Registry trust" },
    { id: "record", label: "On-chain", count: r.feedback.filter((f) => f.tx).length || null },
    { id: "timing", label: "Timing", count: r.calls?.length || null },
    { id: "inspector", label: "Inspector" },
    { id: "benchmarks", label: "Benchmarks" },
    { id: "history", label: "History" },
  ] : [];
  const tab = tabs.find((t) => t.id === tabId)?.id ?? (done ? "answer" : "hiring");

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-4">
            <Wordmark small />
            <Link href="/" className="hidden text-sm text-muted no-underline hover:text-ink sm:inline">How it works</Link>
          </div>
          <span className={`tag ${running ? "tag-yellow" : "tag-gray"}`}>
            <span className={`size-1.5 rounded-full ${running ? "pulse bg-yellow" : "bg-faint"}`} />{running ? "running" : "idle"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pt-10 pb-24 sm:px-8 sm:pt-14">
        {/* ask */}
        <form onSubmit={submit} className="card p-2 transition-shadow focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
          <label htmlFor="q" className="sr-only">Research question</label>
          <textarea
            id="q" ref={input} rows={2} value={question} maxLength={300} required
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Ask a research question…"
            className="block w-full resize-none bg-transparent px-4 pt-3 text-lg text-ink placeholder:text-faint focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-2 pt-1 pb-3">
            <Choice name="length" label="Length" options={LENGTHS} value={length} onChange={setLength} />
            <Choice name="reasoning" label="Reasoning" options={REASONINGS} value={reasoning} onChange={setReasoning} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-2 pb-1">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted select-none"
              title="Takes the main retriever offline mid-run so a backup has to take over. It is switched back on when the run ends.">
              <span className="relative inline-flex">
                <input type="checkbox" checked={kill} onChange={(e) => setKill(e.target.checked)} className="peer sr-only" />
                <span className="h-5 w-9 rounded-full border border-line bg-bone transition-colors peer-checked:border-red peer-checked:bg-red-bg peer-focus-visible:outline-2 peer-focus-visible:outline-ink" />
                <span className="absolute top-1 left-1 size-3 rounded-full bg-faint transition-transform peer-checked:translate-x-4 peer-checked:bg-red" />
              </span>
              Kill main retriever mid-run
            </label>
            <span className="flex items-center gap-3">
              <span className="hidden text-xs text-faint sm:inline"><kbd className="kbd">Enter</kbd> to run</span>
              <button type="submit" disabled={running} className="btn btn-dark disabled:cursor-progress disabled:opacity-60">
                {running ? "Running…" : <>Run <Icon name="arrow" size={15} /></>}
              </button>
            </span>
          </div>
        </form>

        {loaded && !r && !waitingFor && (
          <div className="mt-5 flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}
                className="rounded-md border border-line bg-card px-3 py-1.5 text-left text-sm text-muted transition-colors hover:border-ink hover:text-ink">{q}</button>
            ))}
          </div>
        )}

        <div aria-live="polite">
          {clarify === "checking" && <p className="mt-6 mb-0 flex items-center gap-2 text-sm text-muted"><span className="pulse size-2 rounded-full bg-blue" />Checking the question…</p>}
          {clarify && clarify !== "checking" && <section className="card mt-6 p-6 sm:p-8"><ClarifyOptions c={clarify.c} question={clarify.question} onRun={startRun} /></section>}
          {notice && <p className="mt-6 mb-0 rounded-lg bg-red-bg px-4 py-3 text-sm text-red">{notice}</p>}
        </div>

        {waitingFor && (
          <p className="mt-10 mb-0 flex items-center gap-2 text-muted"><span className="pulse size-2 rounded-full bg-blue" />Reading the registries and screening candidates…</p>
        )}
        {!loaded && <p className="mt-10 mb-0 text-muted">Loading the latest run…</p>}

        {r && (
          <section className="mt-14">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {done
                ? <span className={`tag ${r.error ? "tag-red" : "tag-green"}`}>{r.error ? "stopped" : "finished"}</span>
                : <span className="tag tag-yellow"><span className="pulse size-1.5 rounded-full bg-yellow" />running</span>}
              {r.source && (
                <span
                  className={`tag ${r.source === "mcp" ? "tag-blue" : "tag-gray"}`}
                  title={r.source === "mcp" ? "Started via the Sworn MCP server" : r.source === "cli" ? "Started from the CLI" : "Started from this web app"}
                >
                  {r.source}
                </span>
              )}
              <span>{done ? `took ${seconds(r.started_at, r.finished_at!)} s · ${new Date(r.finished_at!).toLocaleString()}` : `started ${new Date(r.started_at).toLocaleTimeString()}`}</span>
              <span className="font-mono">{r.mode}</span>
              {r.length && <span>{LENGTHS.find((l) => l.id === r.length)?.label} answer · {REASONINGS.find((l) => l.id === r.reasoning)?.label.toLowerCase()} reasoning</span>}
              {viewing && <button type="button" onClick={() => setViewing(null)} className="underline underline-offset-4 hover:text-ink">back to latest run</button>}
            </div>
            <h1 className="serif mt-0 mb-8 text-[clamp(30px,4.4vw,46px)] [text-wrap:balance]">{r.question}</h1>
            <Percent r={r} />
            <Steps r={r} />

            <nav className="sticky top-14 z-20 -mx-5 mt-10 mb-8 overflow-x-auto border-b border-line bg-canvas/90 px-5 backdrop-blur-md [scrollbar-width:none] sm:-mx-8 sm:px-8" aria-label="Views">
              <div className="flex gap-6">
                {tabs.map((t) => (
                  <a key={t.id} href={`#${t.id}`} aria-current={t.id === tab ? "page" : undefined}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 py-3 text-sm whitespace-nowrap no-underline transition-colors ${t.id === tab ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                    {t.label}{t.count != null && <span className="rounded bg-bone px-1.5 font-mono text-[11px] text-muted">{t.count}</span>}
                  </a>
                ))}
              </div>
            </nav>

            <div aria-label={tabs.find((t) => t.id === tab)?.label}>
              {tab === "answer" && (
                <>
                  <Answer r={r} />
                  <FailoverRecord r={r} />
                  {done && !r.error && <><Scoreline r={r} /><FollowUp key={r.run_id} r={r} onRun={startRun} /></>}
                </>
              )}
              {tab === "plan" && <PlanView r={r} />}
              {tab === "sources" && <SourcesView r={r} />}
              {tab === "evidence" && <Evidence r={r} target={claimTarget} />}
              {tab === "hiring" && <HiringView r={r} />}
              {tab === "validations" && <ValidationsView runId={r.run_id} />}
              {tab === "record" && <Record r={r} />}
              {tab === "timing" && <Timing r={r} />}
              {tab === "inspector" && <InspectorView r={r} />}
              {tab === "benchmarks" && <Benchmarks />}
              {tab === "trust" && <Trust />}
              {tab === "history" && <History current={r.run_id} onPick={(id) => { setViewing(id); location.hash = "answer"; }} />}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
