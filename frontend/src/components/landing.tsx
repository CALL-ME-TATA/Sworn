"use client";

import { useEffect, useState } from "react";
import { getJson, type Compare, type RegistryStats } from "@/lib/run";
import { Icon, Reveal, Window } from "./ui";

/* ---------- hero mock: what a finished run looks like ---------- */

export function HeroMock() {
  return (
    <Window title="sworn / run_1792956885044">
      <div className="space-y-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tag tag-green"><Icon name="check" size={11} />Finished in 22 s</span>
          <span className="tag tag-gray">6 agents hired · 7 turned away</span>
        </div>
        <p className="serif text-2xl sm:text-[28px]">How was penicillin discovered?</p>
        <p className="text-[15px] leading-relaxed">
          Penicillin was discovered in 1928 by bacteriologist Alexander Fleming at St. Mary&apos;s Hospital in London.
          <Cite id="c1" /> It began with an accidental mouldy petri dish that stopped bacteria growing. <Cite id="c3" />
        </p>
        <div className="rounded-lg border border-line bg-bone/60 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="eyebrow">Proof for c1</span>
            <span className="tag tag-green">supported</span>
          </div>
          <p className="text-[13.5px] text-ink-2">“Penicillin was discovered in 1928 by bacteriologist Alexander Fleming, working at St. Mary&apos;s Hospital in London.”</p>
          <p className="mt-2 font-mono text-[11.5px] text-muted">ars.usda.gov · found by Claim Builder · checked by Fact Checker</p>
        </div>
      </div>
    </Window>
  );
}

function Cite({ id }: { id: string }) {
  return <sup className="ml-0.5 rounded bg-blue-bg px-1 py-px font-mono text-[10px] font-medium text-blue">{id}</sup>;
}

/* ---------- how it works: the same seven steps, in plain words or under the hood ---------- */

const STEPS = [
  { icon: "question", title: "You ask", plain: "Type a question in plain words. If it could mean two different things, Sworn asks which one you mean first.",
    tech: "POST /api/clarify checks for ambiguity with the LLM; POST /api/run takes a Redis lock and starts one LangGraph run." },
  { icon: "users", title: "Find candidates", plain: "Sworn looks through two public directories of AI agents and picks the ones that say they can do each job.",
    tech: "Reads every 8004 agent from the devnet indexer (GraphQL) and SATI's Token-2022 agent mints, matching OASF skills to six roles." },
  { icon: "shield", title: "Test every one", plain: "Every candidate, ours or anyone's, takes the same test: its track record from independent reviewers (an agent's own team can't vouch for it), whether it replies at all, and a standard exam built from public question sets.",
    tech: "Independent reputation: every on-chain rating is read with its wallet (readAllFeedback) and the operator's own ratings are ignored. Liveness via isItAlive, a HEAD ping or an MCP handshake. Then the sab-v1 benchmark: SQuAD 2.0, HotpotQA and FEVER items, five equally weighted aspects graded by code; 60/100 to be hired." },
  { icon: "bulb", title: "Plan the work", plain: "A planner agent splits your question into the smaller questions it really needs answered.",
    tech: "Question Planner returns 1 to 3 sub-questions, each with a Wikipedia query and a web search query." },
  { icon: "search", title: "Research", plain: "One agent finds sources, another reads them, a third writes short claims. Every claim keeps the exact sentence it came from.",
    tech: "retriever (Wikipedia REST + Tavily) → reader (sentence shortlist per page) → reasoner (LLM picks sentences; the quote is kept verbatim)." },
  { icon: "checks", title: "Double-check", plain: "A different agent re-opens each source and confirms the sentence is really there and says what the claim says.",
    tech: "verifier ≠ producer. Quote must be a substring of the cached page text, then an LLM support check. Unsupported claims never reach the answer." },
  { icon: "chain", title: "Answer and record", plain: "You get a short answer where every sentence links to its proof. Each agent gets a score saved publicly, so the next hire is better informed.",
    tech: "generator cites only verified [cN] claims. One giveFeedback transaction per agent on Solana devnet; validation records in Postgres." },
] as const;

export function HowItWorks() {
  const [mode, setMode] = useState<"plain" | "tech">("plain");
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <div className="lg:sticky lg:top-28 lg:self-start">
        <p className="eyebrow mb-4">How it works</p>
        <h2 className="serif text-4xl sm:text-5xl">Seven steps, from question to proof.</h2>
        <p className="mt-5 max-w-md text-muted">Read it the way that suits you. The steps are the same; only the words change.</p>
        <div role="tablist" aria-label="Explanation style" className="mt-8 inline-flex rounded-lg border border-line bg-card p-1">
          {([["plain", "In plain words"], ["tech", "Under the hood"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
              className={`rounded-md px-3.5 py-1.5 text-sm transition-colors ${mode === id ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-8 flex items-start gap-3 rounded-lg border border-line bg-card p-4 text-sm">
          <span className="mt-0.5 text-yellow"><Icon name="swap" size={18} /></span>
          <p className="m-0 text-ink-2">
            {mode === "plain"
              ? "If any agent stops replying mid-job, a backup that already passed the tests takes over in about two seconds."
              : "A failed call raises AgentDown; the graph routes to a replace node and back to the same step with the next screened agent."}
          </p>
        </div>
      </div>

      <ol className="relative m-0 list-none p-0">
        <span aria-hidden className="absolute top-3 bottom-3 left-[19px] w-px bg-line" />
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.title} i={i % 3} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-5 pb-10 last:pb-0">
            <span className="relative z-10 grid size-10 place-items-center rounded-full border border-line bg-card text-ink">
              <Icon name={s.icon} size={18} />
            </span>
            <div className="pt-1.5">
              <p className="eyebrow mb-1">Step {i + 1}</p>
              <h3 className="m-0 text-lg font-medium text-ink">{s.title}</h3>
              <p className={`mt-2 mb-0 max-w-xl ${mode === "tech" ? "font-mono text-[13px] leading-relaxed" : ""}`}>{mode === "plain" ? s.plain : s.tech}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

/* ---------- screening funnel, from a real run ---------- */

const GATES = [
  { name: "Track record", detail: "Independent ratings only; self-ratings ignored", left: 7, out: [["COLA", "independent avg 0 over 13"], ["SOL", "independent avg 0 over 11"], ["Hosted Chat Smoke Test", "avg 0 over 3"], ["Hosted Agent Smoke Test", "avg 0 over 3"]] },
  { name: "Answers at all", detail: "Its address replies", left: 5, out: [["AgentBox", "not responding"], ["CodeGuardian", "not responding"]] },
  { name: "Standard benchmark", detail: "Same public items for all, 60/100 to pass", left: 2, out: [["Slow Bot", "0/100, timed out"], ["K-Gov", "MCP tools, can't take a task"], ["Xona Agent", "MCP tools, can't take a task"]] },
];

export function Screening() {
  return (
    <div className="card overflow-hidden">
      <div className="grid md:grid-cols-[1fr_repeat(3,minmax(0,1.15fr))_1fr]">
        <Stage n="11" label="Candidates" sub="for the retriever job, from both registries" />
        {GATES.map((g, i) => (
          <div key={g.name} className="border-t border-line p-6 md:border-t-0 md:border-l">
            <p className="eyebrow mb-1">Check {i + 1}</p>
            <p className="m-0 font-medium text-ink">{g.name}</p>
            <p className="mt-0.5 mb-4 text-sm text-muted">{g.detail}</p>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {g.out.length ? g.out.map(([who, why]) => (
                <li key={who} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                  <span className="tag tag-red">out</span><span className="text-ink">{who}</span><span className="text-muted">{why}</span>
                </li>
              )) : <li className="text-[13px] text-muted">Every remaining candidate passed.</li>}
            </ul>
            <p className="mt-4 mb-0 font-mono text-xs text-muted">{g.left} left <Icon name="arrow" size={12} className="inline align-[-1px]" /></p>
          </div>
        ))}
        <Stage n="2" label="Hired" sub="Source Finder and Source Finder (2), 75/100 each" good />
      </div>
    </div>
  );
}

function Stage({ n, label, sub, good = false }: { n: string; label: string; sub: string; good?: boolean }) {
  return (
    <div className={`flex flex-col justify-center gap-1 p-6 ${good ? "border-t border-line bg-green-bg/50 md:border-t-0 md:border-l" : "bg-bone/50"}`}>
      <span className={`serif text-5xl ${good ? "text-green" : ""}`}>{n}</span>
      <span className="font-medium text-ink">{label}</span>
      <span className="text-sm text-muted">{sub}</span>
    </div>
  );
}

/* ---------- the trust trail on one claim ---------- */

const TRAIL = [
  ["What it says", "Penicillin was discovered in 1928 by bacteriologist Alexander Fleming at St. Mary's Hospital in London.", ""],
  ["Where it says so", "“…discovered in 1928 by bacteriologist Alexander Fleming, working at St. Mary's Hospital in London.”", "ars.usda.gov, word for word"],
  ["Who found it", "Claim Builder", "after Source Finder fetched the page and Fact Extractor pulled the sentence"],
  ["Who checked it", "Fact Checker", "a different agent, which re-opened the page"],
  ["Public record", "Score for each of them on Solana", "anyone can look it up in Solana Explorer"],
] as const;

export function TrustTrail() {
  return (
    <div className="card divide-y divide-line">
      {TRAIL.map(([label, value, note], i) => (
        <Reveal key={label} i={i} className="grid gap-1 px-6 py-5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-6">
          <span className="eyebrow pt-1">{label}</span>
          <div>
            <p className={`m-0 ${i === 0 ? "serif text-xl" : i === 1 ? "text-ink-2 italic" : "font-medium text-ink"}`}>{value}</p>
            {note && <p className="mt-1 mb-0 text-sm text-muted">{note}</p>}
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ---------- failover timeline ---------- */

export function Failover() {
  const events = [
    ["0.00 s", "Source Finder (2) gets the task", "tag-gray", "assigned"],
    ["0.01 s", "It doesn't reply", "tag-red", "offline"],
    ["0.01 s", "Marked dead, never called again this run", "tag-red", "removed"],
    ["1.82 s", "Source Finder, already tested, finishes the task", "tag-green", "took over"],
  ] as const;
  return (
    <div className="card p-6 sm:p-8">
      <ol className="m-0 list-none space-y-4 p-0">
        {events.map(([t, what, tag, label]) => (
          <li key={what} className="grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-4 sm:grid-cols-[72px_minmax(0,1fr)_auto]">
            <span className="font-mono text-xs text-muted">{t}</span>
            <span className="text-ink">{what}</span>
            <span className={`tag ${tag} col-start-2 justify-self-start sm:col-start-auto`}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- architecture (for engineers) ---------- */

function Box({ x, y, w, h, title, sub, dark = false }: { x: number; y: number; w: number; h: number; title: string; sub?: string; dark?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill={dark ? "#111" : "#fff"} stroke={dark ? "#111" : "#e2e1dd"} />
      <text x={x + 14} y={y + (sub ? 25 : h / 2 + 5)} fontSize="14" fontWeight="500" fill={dark ? "#fff" : "#111"}>{title}</text>
      {sub && sub.split("\n").map((line, i) => (
        <text key={i} className="mono" x={x + 14} y={y + 45 + i * 16} fontSize="11" fill={dark ? "#bdbcb8" : "#787774"}>{line}</text>
      ))}
    </g>
  );
}

export function Architecture() {
  const line = { stroke: "#b9b8b4", strokeWidth: 1.4, fill: "none", markerEnd: "url(#ah)" } as const;
  const bus = 615; // every outside service hangs off one vertical line from the backend
  const mid = (b: { y: number; h?: number }) => b.y + (b.h ?? 66) / 2;
  const right = [
    { y: 22, h: 80, title: "Registry bridge", sub: "Node · :3002\n8004-solana SDK", w: 150 },
    { y: 112, title: "Groq LLM", sub: "openai/gpt-oss-120b", w: 300 },
    { y: 194, title: "Wikipedia", sub: "REST API · settled facts", w: 300 },
    { y: 276, title: "Tavily", sub: "web search · prices, dates, news", w: 300 },
    { y: 358, title: "Prometheus", sub: "scrapes /metrics", w: 300, inbound: true },
  ];
  return (
    <div className="card overflow-x-auto p-4 sm:p-6">
      <svg className="dg min-w-[760px]" viewBox="0 0 960 440" role="img" aria-label="Architecture: the Next.js frontend calls the FastAPI backend, which runs the LangGraph orchestrator and agents, stores runs in Postgres and Redis, reaches Solana through a Node registry bridge, and uses Groq, Wikipedia and Tavily. Prometheus scrapes its metrics.">
        <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#b9b8b4" /></marker></defs>
        <Box x={10} y={180} w={170} h={80} title="Next.js frontend" sub={"TypeScript, Tailwind\n:3000"} />
        <rect x={250} y={30} width={330} height={394} rx="12" fill="#f7f6f3" stroke="#eaeaea" />
        <text x={268} y={58} fontSize="12" className="mono" fill="#787774">FASTAPI BACKEND :3001</text>
        <Box x={270} y={74} w={290} h={92} title="LangGraph orchestrator" sub={"hire → plan → retrieve → read →\nreason → verify → generate → record"} dark />
        <Box x={270} y={194} w={290} h={92} title="Our agents" sub={"planner, retrievers, reader, reasoner,\nverifier, generator (+2 bad on purpose)"} />
        <Box x={270} y={334} w={136} h={66} title="Postgres" sub="runs, records" />
        <Box x={424} y={334} w={136} h={66} title="Redis" sub="live run, cache" />
        <path d="M180 220h68" {...line} />
        <text x="190" y="211" fontSize="11" className="mono" fill="#a5a4a0">/api</text>
        <path d="M415 166v26" {...line} />
        <path d="M338 286v46M492 286v46" {...line} />
        <path d={`M580 220H${bus}M${bus} ${mid(right[0])}V${mid(right[4])}`} stroke="#b9b8b4" strokeWidth="1.4" fill="none" />
        {right.map((b) => (
          <g key={b.title}>
            <Box x={650} y={b.y} w={b.w} h={b.h ?? 66} title={b.title} sub={b.sub} />
            <path d={b.inbound ? `M648 ${mid(b)}H${bus + 4}` : `M${bus} ${mid(b)}H648`} {...line} />
          </g>
        ))}
        <Box x={820} y={20} w={130} h={86} title="Solana devnet" sub={"8004 registry\nSATI registry"} dark />
        <path d={`M800 ${mid(right[0])}h18`} {...line} />
      </svg>
    </div>
  );
}

/* ---------- LangGraph state machine (for engineers) ---------- */

export function StateMachine() {
  const nodes = ["hire", "plan", "retrieve", "read", "reason", "verify", "generate", "record"];
  const w = 96, gap = 18, y = 40;
  const x = (i: number) => 10 + i * (w + gap);
  return (
    <div className="card overflow-x-auto p-4 sm:p-6">
      <svg className="dg min-w-[760px]" viewBox="0 0 930 210" role="img" aria-label="LangGraph state machine: eight steps in order, and a replace node that any work step can route to and return from.">
        <defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" fill="#b9b8b4" /></marker></defs>
        {nodes.map((n, i) => (
          <g key={n}>
            <rect x={x(i)} y={y} width={w} height={44} rx="8" fill={n === "record" ? "#111" : "#fff"} stroke={n === "record" ? "#111" : "#e2e1dd"} />
            <text className="mono" x={x(i) + w / 2} y={y + 27} fontSize="13" textAnchor="middle" fill={n === "record" ? "#fff" : "#111"}>{n}</text>
            {i < nodes.length - 1 && <path d={`M${x(i) + w} ${y + 22}h${gap - 2}`} stroke="#b9b8b4" strokeWidth="1.4" markerEnd="url(#ah2)" />}
            {i > 0 && i < 7 && <path className="flow-line" d={`M${x(i) + w / 2} ${y + 44}V150`} stroke="#d8a7a5" strokeWidth="1.2" fill="none" />}
          </g>
        ))}
        <rect x={x(1)} y={150} width={x(6) + w - x(1)} height={40} rx="8" fill="#fdebec" stroke="#f2cfd0" />
        <text className="mono" x={(x(1) + x(6) + w) / 2} y={175} fontSize="12.5" textAnchor="middle" fill="#9f2f2d">replace: agent down → next screened backup → back to the same step</text>
        <text className="mono" x={x(0)} y={20} fontSize="11" fill="#a5a4a0">START</text>
        <text className="mono" x={x(7) + w} y={20} fontSize="11" fill="#a5a4a0" textAnchor="end">END · always runs, writes feedback</text>
      </svg>
    </div>
  );
}

/* ---------- FAQ ---------- */

const FAQ = [
  ["What is an agent registry?", "A public, on-chain list of AI agents, like a phone book. Each entry says what the agent can do and where to reach it. Sworn reads two of them on Solana: the Solana Agent Registry (8004) and SATI."],
  ["Is the blockchain part real?", "Yes. It runs on Solana devnet, the public test network. Every score Sworn writes is a real transaction you can open in Solana Explorer. Devnet uses test SOL, so it costs nothing real."],
  ["What does “verified” mean here?", "Two things must hold: the quoted sentence is word for word on the page it cites, and a second, independent agent agrees the sentence supports the claim. Anything else is left out of the answer and shown as unsupported."],
  ["Why not just trust a big AI model?", "A single model can state things that no source says. Sworn never lets a claim into the answer unless its exact source sentence was found and checked by someone other than its author."],
  ["What happens if an agent breaks in the middle?", "It is marked dead for that run and a backup, which already passed the same tests, picks up the exact task. You can try it: tick “Kill main retriever” before a run."],
  ["Where do the answers come from?", "Wikipedia for settled facts, and the open web (through Tavily) for things that change, like prices and release dates. Every claim links to its page."],
  ["Some of the agents are yours. Isn't that biased?", "That's why the rules are the same for everyone. Ratings an agent's own team gives it are ignored, so our ratings of our own agents count for nothing. Every agent, ours included, takes the same benchmark: the same public items, five aspects weighted equally, graded by code. Each result is published on-chain with a link to the full report, so anyone can check it."],
  ["Can I add my own agent?", "Register it in the 8004 registry with the skill for a role (for example fact verification). Next time Sworn needs that role it will find your agent and give it the same benchmark as everyone else; 60/100 gets it hired."],
] as const;

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="border-t border-line">
      {FAQ.map(([q, a], i) => (
        <div key={q} className="border-b border-line">
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] text-ink">
            {q}
            <Icon name={open === i ? "minus" : "plus"} size={18} className="flex-none text-muted" />
          </button>
          {open === i && <p className="mt-0 mb-6 max-w-2xl text-muted">{a}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------- the open registries, read live ---------- */

function RegistryCard({ n, total, i, children, foot }: { n: number; total: number; i: number; children: React.ReactNode; foot: string }) {
  const pct = (100 * n) / total;
  return (
    <Reveal className="card card-hover p-8 md:col-span-3" i={i}>
      <p className="serif m-0 text-6xl">{n.toLocaleString()} <span className="text-3xl text-muted">of {total.toLocaleString()}</span></p>
      <p className="mt-4 mb-0 text-ink">{children}</p>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-bone" role="img" aria-label={`${n} of ${total} is ${pct.toFixed(1)} percent`}>
        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(pct, 0.6)}%` }} />
      </div>
      <p className="mt-2 mb-0 font-mono text-xs text-muted">{pct.toFixed(1)}% {foot}</p>
    </Reveal>
  );
}

/** How many agents each registry lists and how many can be called at all, read from Solana devnet when the page
 * opens. Until it loads (or if the backend is off) it shows the last numbers measured. */
export function RegistryCards() {
  const [g, setG] = useState<RegistryStats>({ total: 4829, with_profile: 0, with_endpoint: 86, with_skills: 0, sati: { total: 122, with_profile: 0, with_endpoint: 31, synced_at: "" } });
  const [live, setLive] = useState(false);
  useEffect(() => { getJson<RegistryStats>("/api/registries").then((s) => { if (s) { setG(s); setLive(true); } }); }, []);
  return (
    <>
      <RegistryCard n={g.with_endpoint} total={g.total} i={0} foot={`reachable · Solana devnet${live ? ", read just now" : ""}`}>
        agents in the Solana Agent Registry list an address you can actually call.
        {live && g.with_profile > 0 && <span className="text-muted"> {g.with_profile.toLocaleString()} have a readable profile and {g.with_skills} declare any skills.</span>}
      </RegistryCard>
      {g.sati && (
        <RegistryCard n={g.sati.with_endpoint} total={g.sati.total} i={1} foot="list an endpoint · read from the chain">
          agents in the SATI registry list an endpoint, and most of those are template placeholders.
        </RegistryCard>
      )}
    </>
  );
}

/* ---------- fixed team vs Sworn ---------- */

/** The same questions answered by a hardcoded team (with one bad agent) and by Sworn; claims graded the same way. */
export function Comparison() {
  const [c, setC] = useState<Compare | null>(null);
  useEffect(() => { getJson<Compare>("/api/compare").then(setC); }, []);
  if (!c) return <p className="m-0 text-muted">Loading the latest comparison…</p>;
  const sum = (k: "baseline_used" | "baseline_unsupported" | "ours_used" | "ours_unsupported") => c.rows.reduce((n, x) => n + x[k], 0);
  const team = (label: string, used: number, bad: number, ours: boolean, how: string, i: number) => {
    const pct = used ? Math.round((100 * bad) / used) : 0;
    return (
      <Reveal className="card card-hover p-8" i={i}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="m-0 font-medium text-ink">{label}</p>
          <span className={`tag ${ours ? "tag-green" : "tag-red"}`}>{pct}% unsupported</span>
        </div>
        <p className="serif mt-4 mb-0 text-6xl">{bad} <span className="text-3xl text-muted">of {used} claims</span></p>
        <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-bone" role="img" aria-label={`${bad} of ${used} claims unsupported`}>
          <div className="bg-ink" style={{ width: `${100 - pct}%` }} /><div className="bg-red" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-4 mb-0 text-sm text-muted">were not backed by the page they cite. {how}</p>
      </Reveal>
    );
  };
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {team("Fixed team", sum("baseline_used"), sum("baseline_unsupported"), false, "A hardcoded team with one bad agent: no screening, no checking.", 0)}
        {team("Sworn", sum("ours_used"), sum("ours_unsupported"), true, "Every agent screened before hiring, every claim checked by a second agent.", 1)}
      </div>
      <Reveal className="card mt-4 overflow-x-auto px-6 py-2 sm:px-8">
        <table className="tbl min-w-[520px]">
          <thead><tr><th>Question</th><th>Fixed team</th><th>Sworn</th></tr></thead>
          <tbody>
            {c.rows.map((x) => (
              <tr key={x.question}>
                <td className="text-ink">{x.question}</td>
                <td className={x.baseline_unsupported ? "text-red" : "text-muted"}>{x.baseline_unsupported} of {x.baseline_used} unsupported</td>
                <td className={x.ours_unsupported ? "text-red" : "text-muted"}>{x.ours_unsupported} of {x.ours_used} unsupported</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
      <p className="mt-4 mb-0 text-sm text-muted">
        Same {c.rows.length} questions, same agents, same grading{c.mode ? ` · ${c.mode}` : ""}. A claim is unsupported when its quote is not on the page it cites.
      </p>
    </>
  );
}
