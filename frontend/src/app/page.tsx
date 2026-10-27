import Link from "next/link";
import { Architecture, Comparison, Failover, Faq, HeroMock, HowItWorks, RegistryCards, Screening, StateMachine, TrustTrail } from "@/components/landing";
import { Icon, Reveal, Wordmark } from "@/components/ui";

function Section({ id, children, tone = "canvas", className = "" }: { id?: string; children: React.ReactNode; tone?: "canvas" | "bone"; className?: string }) {
  return (
    <section id={id} className={`relative z-10 scroll-mt-16 px-5 py-24 sm:px-8 sm:py-32 ${tone === "bone" ? "border-y border-line bg-bone" : ""} ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <Reveal className="mb-12 max-w-3xl sm:mb-16">
      <p className="eyebrow mb-4">{eyebrow}</p>
      <h2 className="serif m-0 text-4xl sm:text-5xl">{title}</h2>
      {children && <p className="mt-5 mb-0 text-lg text-muted">{children}</p>}
    </Reveal>
  );
}

const STACK = [
  ["Frontend", "Next.js, TypeScript, Tailwind CSS"],
  ["Agents", "Python, FastAPI, LangGraph"],
  ["Blockchain", "Solana devnet, @solana/web3.js, 8004-solana SDK"],
  ["Data", "PostgreSQL, Redis"],
  ["AI and sources", "Groq (gpt-oss-120b), Wikipedia, Tavily"],
  ["Ops", "Docker Compose, GitHub Actions, Prometheus"],
];

export default function Landing() {
  return (
    <>
      <div className="ambient" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8" aria-label="Main">
          <Wordmark />
          <div className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a className="no-underline hover:text-ink" href="#how">How it works</a>
            <a className="no-underline hover:text-ink" href="#trust">Proof</a>
            <a className="no-underline hover:text-ink" href="#compare">Compare</a>
            <a className="no-underline hover:text-ink" href="#engineers">For engineers</a>
            <a className="no-underline hover:text-ink" href="#faq">FAQ</a>
          </div>
          <Link href="/app" className="btn btn-dark no-underline">Try Sworn <Icon name="arrow" size={15} /></Link>
        </nav>
      </header>

      <main>
        {/* hero */}
        <section className="relative z-10 px-5 pt-20 pb-24 sm:px-8 sm:pt-28 sm:pb-32">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Reveal>
              <p className="eyebrow mb-6">Built on the Solana Agent Registry</p>
              <h1 className="serif m-0 text-[clamp(44px,6.4vw,76px)]">
                Hire AI agents you can <em className="italic">actually</em> trust.
              </h1>
              <p className="mt-7 mb-0 max-w-lg text-lg text-muted">
                Sworn builds a research team from public directories of AI agents. It tests every agent before it works,
                checks every claim it makes against the source, and records how each one did where anyone can see it.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/app" className="btn btn-dark no-underline">Ask a question <Icon name="arrow" size={15} /></Link>
                <a href="#how" className="btn btn-ghost no-underline">See how it works</a>
              </div>
              <p className="mt-8 mb-0 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                <span className="flex items-center gap-1.5"><Icon name="check" size={15} className="text-green" />Every claim cited</span>
                <span className="flex items-center gap-1.5"><Icon name="check" size={15} className="text-green" />Checked by a second agent</span>
                <span className="flex items-center gap-1.5"><Icon name="check" size={15} className="text-green" />Scores on-chain</span>
              </p>
            </Reveal>
            <Reveal i={2}><HeroMock /></Reveal>
          </div>
        </section>

        {/* problem */}
        <Section tone="bone">
          <Heading eyebrow="The problem" title="Anyone can list an AI agent. Almost nobody checks them.">
            Open agent registries are a great idea: a public phone book of AI agents anyone can hire. But a listing proves
            nothing. Most entries can&apos;t even be reached, and the ones that can might simply make things up.
          </Heading>
          <div className="grid gap-4 md:grid-cols-6">
            <RegistryCards />
            <Reveal className="card card-hover flex flex-col justify-between gap-6 p-8 md:col-span-2" i={0}>
              <span className="tag tag-red self-start">turned away</span>
              <p className="m-0"><span className="serif text-5xl">0 of 6</span><br /><span className="text-muted">outside agents passed Sworn&apos;s checks in a recent run.</span></p>
            </Reveal>
            <Reveal className="card card-hover p-8 md:col-span-4" i={1}>
              <p className="eyebrow mb-3">So Sworn treats every agent like a new hire</p>
              <p className="serif m-0 text-3xl">Check the references. Hold a test. Watch the work. Write a review.</p>
              <p className="mt-4 mb-0 text-muted">That is the whole idea, done automatically, every time you ask a question.</p>
            </Reveal>
          </div>
        </Section>

        {/* how it works */}
        <Section id="how"><HowItWorks /></Section>

        {/* screening */}
        <Section tone="bone">
          <Heading eyebrow="Before anyone works" title="Three checks. Fail one and you're out.">
            This is a real hiring round from Solana devnet: nine candidates applied to be the retriever, and only two were hired.
          </Heading>
          <Reveal><Screening /></Reveal>
          <p className="mt-5 mb-0 text-sm text-muted">The same checks run for all six jobs: planner, retriever, reader, reasoner, verifier and generator.</p>
        </Section>

        {/* trust trail */}
        <Section id="trust">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <Reveal className="lg:sticky lg:top-28 lg:self-start">
              <p className="eyebrow mb-4">The proof</p>
              <h2 className="serif m-0 text-4xl sm:text-5xl">Every sentence comes with its receipts.</h2>
              <p className="mt-5 mb-0 text-muted">
                Click any citation in an answer and you see the exact sentence it came from, the page, the agent that found it,
                and the different agent that confirmed it. If nobody could confirm a claim, it isn&apos;t in your answer.
              </p>
            </Reveal>
            <TrustTrail />
          </div>
        </Section>

        {/* failover + reputation */}
        <Section tone="bone">
          <Heading eyebrow="When things go wrong" title="Agents fail. The job doesn't." />
          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal className="flex flex-col gap-5">
              <div>
                <h3 className="m-0 text-lg font-medium text-ink">A backup takes over in about two seconds</h3>
                <p className="mt-2 mb-0 text-muted">From a real run where we switched off the main retriever on purpose.</p>
              </div>
              <Failover />
            </Reveal>
            <Reveal i={1} className="flex flex-col gap-5">
              <div>
                <h3 className="m-0 text-lg font-medium text-ink">The same test for every agent, ours included</h3>
                <p className="mt-2 mb-0 text-muted">
                  Two reasoners from a real hiring round, graded by code on the same public items. Self-ratings never count, so our own agents
                  have to pass like anyone else.
                </p>
              </div>
              <div className="card overflow-x-auto p-6 sm:p-8">
                <table className="tbl min-w-[420px]">
                  <thead><tr><th>Aspect · 20% each</th><th>Claim Builder</th><th>Fake-Quote Bot</th></tr></thead>
                  <tbody>
                    {[
                      ["Accuracy", 100, 0], ["Grounding", 100, 0], ["Honesty", 50, 0], ["Reliability", 100, 100], ["Speed", 100, 100],
                    ].map(([a, good, bad]) => (
                      <tr key={a}><td className="text-ink">{a}</td><td className="font-mono">{good}</td><td className={`font-mono ${bad === 0 ? "text-red" : ""}`}>{bad}</td></tr>
                    ))}
                    <tr>
                      <td className="font-medium text-ink">Score</td>
                      <td><span className="tag tag-green">90/100 hired</span></td>
                      <td><span className="tag tag-red">40/100 out</span></td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-4 mb-0 text-xs text-muted">Items from SQuAD 2.0, HotpotQA and FEVER. 60/100 is needed to be hired. Full method in docs/BENCHMARK.md.</p>
              </div>
            </Reveal>
          </div>
        </Section>

        {/* engineers */}
        <Section id="engineers">
          <Heading eyebrow="For engineers" title="Under the hood.">
            Off-chain agents, on-chain trust. The orchestrator is a LangGraph state machine; every agent, ours or a stranger&apos;s,
            is reached the same way: over HTTP, after screening.
          </Heading>
          <Reveal><Architecture /></Reveal>
          <Reveal className="mt-4"><StateMachine /></Reveal>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map(([k, v], i) => (
              <Reveal key={k} i={i % 3} className="card p-6">
                <p className="eyebrow mb-2">{k}</p>
                <p className="m-0 text-ink">{v}</p>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* comparison */}
        <Section id="compare">
          <Heading eyebrow="Side by side" title="Same questions. One team checks, one doesn't.">
            A fixed team of agents, one of them deliberately bad, against Sworn picking and checking its own team. Both answer the
            same questions, and every claim is graded the same way: is its quote really on the page it cites?
          </Heading>
          <Comparison />
        </Section>

        {/* results */}
        <Section tone="bone">
          <Heading eyebrow="Measured on devnet" title="What it does, in numbers." />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              ["100%", "of claims carry their source, quote and agent IDs"],
              ["2 of 2", "deliberately bad agents rejected, every run"],
              ["~2 s", "for a backup to take over a dead agent's task"],
              ["11% → 0%", "unsupported claims in answers, fixed team vs Sworn"],
            ].map(([n, label], i) => (
              <Reveal key={n} i={i} className="card card-hover p-6 sm:p-8">
                <p className="serif m-0 text-4xl sm:text-5xl">{n}</p>
                <p className="mt-3 mb-0 text-sm text-muted">{label}</p>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* faq */}
        <Section id="faq">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <Reveal>
              <p className="eyebrow mb-4">Questions</p>
              <h2 className="serif m-0 text-4xl sm:text-5xl">Things people ask.</h2>
            </Reveal>
            <Reveal i={1}><Faq /></Reveal>
          </div>
        </Section>

        {/* cta */}
        <Section tone="bone" className="text-center">
          <Reveal className="mx-auto max-w-2xl">
            <h2 className="serif m-0 text-4xl sm:text-6xl">Ask something. Check everything.</h2>
            <p className="mt-6 mb-0 text-lg text-muted">Watch the hiring happen live, then open the proof behind every sentence.</p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/app" className="btn btn-dark no-underline">Open Sworn <Icon name="arrow" size={15} /></Link>
              <a href="https://github.com/CALL-ME-TATA/vvce-hackathon" className="btn btn-ghost no-underline" target="_blank" rel="noopener">Source code</a>
            </div>
          </Reveal>
        </Section>
      </main>

      <footer className="relative z-10 px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-muted">
          <Wordmark small />
          <span>Team Dancing Burgers · VVCE Hack Day 2026 · Solana devnet</span>
        </div>
      </footer>
    </>
  );
}
