"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HiringView } from "@/components/Hiring";
import { Answer, Baseline, ClarifyOptions, Evidence, FollowUp, History, Record, Registries, Scoreline, Steps } from "@/components/Views";
import { askClarify, getJson, postJson, seconds, type Clarify, type Compare, type Run } from "@/lib/run";

const EXAMPLES = [
  "How was penicillin discovered and why did it matter?",
  "What causes coral bleaching and where has it happened?",
  "How do vaccines train the immune system?",
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

export default function Page() {
  const [run, setRun] = useState<Run | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string | null>(null); // run_id that was latest when we started a new run
  const [viewing, setViewing] = useState<string | null>(null);       // a past run picked from History
  const [compare, setCompare] = useState<Compare | null>(null);
  const [question, setQuestion] = useState("");
  const [kill, setKill] = useState(false);
  const [clarify, setClarify] = useState<ClarifyBox>(null);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hash = useHash();

  const load = useCallback(async () => {
    const [status, r] = await Promise.all([
      getJson<{ running: boolean }>("/api/status"),
      getJson<Run>(viewing ? `/api/runs/${viewing}` : "/api/runs/latest"),
    ]);
    setRunning(Boolean(status?.running));
    setLoaded(true);
    if (r && waitingFor && r.run_id !== waitingFor) setWaitingFor(null);
    if (r) setRun(r);
    return { busy: Boolean(status?.running) || Boolean(waitingFor) || Boolean(r && !r.finished_at) };
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

  useEffect(() => { getJson<Compare>("/api/compare").then(setCompare); }, []);

  async function startRun(q: string) {
    setClarify(null);
    setQuestion(q);
    setViewing(null);
    const res = await postJson("/api/run", { question: q, kill });
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({})))?.detail ?? `Could not start the run (HTTP ${res.status}). Is the backend running?`);
      return;
    }
    setNotice("");
    setWaitingFor(run?.run_id ?? "none");
    history.replaceState(null, "", location.pathname); // a new run starts on its default tab
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0 });
  }

  // Run button: check the question first; only an unclear question stops to ask.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
    { id: "evidence", label: "Evidence", count: r.claims.length || null },
    { id: "hiring", label: "Hiring", count: r.hiring.length ? `${r.hiring.filter((h) => h.result === "failed").length} out` : null },
    { id: "record", label: "On-chain record", count: r.feedback.length ? r.feedback.filter((f) => f.tx).length : null },
    { id: "registries", label: "Registries" },
    { id: "baseline", label: "Fixed team vs ours" },
    { id: "history", label: "History" },
  ] : [];
  const tab = tabs.find((t) => t.id === tabId)?.id ?? (done ? "answer" : "hiring");

  return (
    <>
      <header className="bar">
        <div className="font-display text-[22px] leading-none font-extrabold tracking-[.02em] whitespace-nowrap uppercase">
          Sworn <span className="font-semibold text-on-ink">· Trusted Agent Hiring</span>
        </div>
        <form onSubmit={submit} className="flex min-w-0 gap-2">
          <input
            ref={input} type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
            aria-label="Research question" placeholder="Ask a research question" required maxLength={300} autoComplete="off"
            className="h-[46px] min-w-0 flex-1 border-2 border-transparent bg-sheet px-4 text-[17px] font-medium text-ink placeholder:text-ink-3 focus-visible:border-blue focus-visible:outline-none"
          />
          <button
            type="submit" disabled={running}
            className="h-[46px] border-2 border-sheet bg-ink px-6 font-display text-[19px] font-extrabold tracking-[.08em] text-sheet uppercase transition-colors hover:bg-sheet hover:text-ink active:translate-y-px disabled:cursor-progress disabled:border-ink-3 disabled:bg-ink disabled:text-on-ink"
          >
            {running ? "Running" : "Run"}
          </button>
        </form>
        <label className="kill flex cursor-pointer items-center gap-2 border-l border-[#3a3e46] pl-6 select-none"
          title="Demo of failover: takes the main retriever offline mid-run so a backup has to take over. It is switched back on when the run ends.">
          <input type="checkbox" checked={kill} onChange={(e) => setKill(e.target.checked)} />
          <span className="box" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="#fbfbf8" strokeWidth="2.4" strokeLinecap="square" /></svg>
          </span>
          <span className="lbl font-display text-base leading-tight font-bold tracking-[.04em] text-[#ff8a84] uppercase">Kill main retriever<br />mid-run</span>
        </label>
      </header>

      {r && (
        <div className="viewbar">
          <nav className="tabs mx-auto flex max-w-[1440px] overflow-x-auto px-6 [scrollbar-width:none]" aria-label="Views">
            {tabs.map((t) => (
              <a key={t.id} href={`#${t.id}`} aria-current={t.id === tab ? "page" : undefined}>
                {t.label}{t.count != null && <span className="count">{t.count}</span>}
              </a>
            ))}
          </nav>
        </div>
      )}

      <main className="mx-auto max-w-[1440px] px-6 pt-8 pb-[72px] max-md:px-4">
        <div aria-live="polite">
          {clarify === "checking" && <div className="clarify"><p className="m-0 label-caps text-lg text-blue">Checking the question...</p></div>}
          {clarify && clarify !== "checking" && <section className="clarify"><ClarifyOptions c={clarify.c} question={clarify.question} onRun={startRun} /></section>}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-medium text-ink-2" role="status" aria-live="polite">
          {notice ? <span className="text-red">{notice}</span>
            : waitingFor ? <><span className="label-caps bg-blue px-2.5 pt-[5px] pb-1 text-base text-sheet">Starting</span> Reading the registries and screening candidates...</>
            : !loaded ? "Loading the latest run..."
            : r && <>
              {done ? <b className="label-caps text-base text-ink">{r.error ? "Stopped" : "Finished"}</b> : <span className="label-caps bg-blue px-2.5 pt-[5px] pb-1 text-base text-sheet">Running</span>}
              <span>{done ? `took ${seconds(r.started_at, r.finished_at!)} s · ${new Date(r.finished_at!).toLocaleString()}` : `started ${new Date(r.started_at).toLocaleTimeString()}`}</span>
              <span>{r.mode}</span> <code>{r.run_id}</code>
              {viewing && <button type="button" className="linkish" onClick={() => setViewing(null)}>Back to the latest run</button>}
            </>}
        </div>

        {loaded && !r && !waitingFor && (
          <section className="border-t-[6px] border-ink bg-sheet p-8">
            <h1 className="m-0 mb-3 max-w-[20ch] font-display text-[clamp(34px,4.4vw,56px)] leading-none font-extrabold uppercase">Hire agents you can trust</h1>
            <p className="mb-6 max-w-[62ch] text-[19px] text-ink-2">
              Every candidate from the open Solana registries is screened on its on-chain reputation, whether it is alive, and a known-answer trial.
              Only survivors are hired, every claim is checked by a different agent, and every agent&apos;s score goes back on-chain.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => { setQuestion(q); input.current?.focus(); }}
                  className="cursor-pointer border-2 border-ink px-3 py-2 text-left font-semibold hover:bg-ink hover:text-sheet">{q}</button>
              ))}
            </div>
          </section>
        )}

        {r && (
          <>
            <Steps r={r} />
            <h1 className={`m-0 font-display leading-[1.02] font-extrabold uppercase [text-wrap:balance] ${done ? "mb-6 max-w-[40ch] text-[clamp(30px,3.6vw,48px)]" : "mb-3 text-[clamp(24px,2.4vw,32px)]"}`}>{r.question}</h1>
            <section className="view" aria-label={tabs.find((t) => t.id === tab)?.label}>
              {tab === "answer" && (
                <div className="mt-6">
                  <Answer r={r} />
                  {done && !r.error && <><Scoreline r={r} /><FollowUp key={r.run_id} r={r} onRun={startRun} /></>}
                </div>
              )}
              {tab === "evidence" && <Evidence r={r} target={claimTarget} />}
              {tab === "hiring" && <HiringView r={r} />}
              {tab === "record" && <Record r={r} />}
              {tab === "registries" && <Registries r={r} />}
              {tab === "baseline" && <Baseline compare={compare} />}
              {tab === "history" && <History current={r.run_id} onPick={(id) => { setViewing(id); location.hash = "answer"; }} />}
            </section>
          </>
        )}
      </main>
    </>
  );
}
