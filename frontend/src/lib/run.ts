// Shape of a run report (backend/app/orchestrator.py) and small helpers shared by the views.

export const ROLES = ["planner", "retriever", "reader", "reasoner", "verifier", "generator"] as const;
export type Role = (typeof ROLES)[number];
export const ROUNDS = ["reputation", "alive", "trial"] as const;
export const ASPECTS = ["accuracy", "grounding", "honesty", "reliability", "speed"] as const;
export type Aspect = (typeof ASPECTS)[number];
export type BenchmarkRow = { id: number; asset: string; name: string; role: Role; version: string; day: string; score: number; tx: string | null; aspects: Partial<Record<Aspect, number>> };

export type Hiring = {
  asset: string; name: string; role: Role; ours: boolean; registry: "8004" | "sati";
  stage: "reputation" | "alive" | "trial" | "hired"; result: "checking" | "passed" | "failed" | "busy"; // busy: our AI provider was out of quota, not scored
  reason: string | null; score: number | null; ratings: number; self_ratings?: number; protocol?: string;
  ignored?: Partial<Record<TrustFlag | "operator", number>> | null; // ratings left out of the score, and why
  bench?: { id?: number; score: number; aspects: Partial<Record<Aspect, number>>; cached: boolean; version: string };
};
export type Member = { asset: string; name: string };
/** The fake-reputation detector's report (backend/app/trust.py). */
export type TrustFlag = "self" | "captive" | "burst" | "single_source" | "ring";
/** The detector's rules, as shown to people. */
export const FLAG_TEXT: Record<TrustFlag | "operator", { label: string; about: string }> = {
  self: { label: "self", about: "the rater owns the agent" },
  captive: { label: "captive wallet", about: "the wallet has rated 3+ times, always one owner's agents: usually the owner's second wallet" },
  burst: { label: "burst", about: "under 10 s after the same wallet rated that owner's agents: a script, not a customer" },
  single_source: { label: "single source", about: "all of the agent's 3+ ratings come from one wallet" },
  ring: { label: "ring", about: "two operators rate each other's agents" },
  operator: { label: "operator", about: "a wallet known to belong to the agent's own operator" },
};
export type TrustAgent = {
  asset: string; owner: string; name?: string | null; ratings: number; raters: number; raw: number | null; independent: number | null;
  independent_count: number; independent_pct: number; flags: Partial<Record<TrustFlag, number>>; verdict: "independent" | "mostly_flagged" | "no_independent";
};
export type TrustReport = {
  summary: {
    ratings: number; agents: number; raters: number; owners: number; flagged: number; flagged_pct: number; by_flag: Record<TrustFlag, number>;
    captive_wallets: number; captive_ratings_pct: number; verdicts: Partial<Record<TrustAgent["verdict"], number>>; agents_3plus: number; updated_at: number;
  };
  agents: TrustAgent[];
  graph: {
    nodes: { id: string; owner: boolean; rates: boolean; agents: number; captive: boolean; ratings_given: number }[];
    edges: { source: string; target: string; n: number; flagged: boolean; why: TrustFlag | null }[];
  };
  ours: Record<string, string>; // our wallets: address -> "owner" | "reviewer"
};
export type Task = {
  id: string; question: string; search: string; web?: string; planned_by_name?: string;
  sources?: { title: string; url: string }[]; retrieved_by_name?: string;
  facts?: unknown[]; read_by_name?: string; reasoned_by?: string; reasoned_by_name?: string;
};
export type Claim = {
  id: string; sub_question: string; text: string; quote: string; source_url: string;
  retrieved_by_name?: string; read_by_name?: string; produced_by: string; produced_by_name: string;
  verified_by?: string; verified_by_name?: string; status: "pending" | "supported" | "unsupported" | "unreachable"; reason?: string | null;
};
export type Failover = {
  role: Role; from: string; from_name: string; to: string; to_name: string; task_id: string; reason: string; took_ms: number;
  // recorded since the timing update; older runs lack them
  failed_at_ms?: number; fail_ms?: number; switch_ms?: number; backup_ms?: number; recovered_at_ms?: number;
};
export type Call = { role: Role; agent: string; task_id: string; at_ms: number; ms: number | null; ok: boolean; error?: string };
export type Feedback = {
  asset: string; name: string; role: Role; ours: boolean; registry: string; score: number; outcome: string; tx?: string; error?: string;
  aspects?: Partial<Record<Aspect, number>>; // what the score is the mean of
  measured?: { benchmark: Partial<Record<Aspect, number>> | null; run: Partial<Record<Aspect, number>> }; // where each aspect came from
  evidence?: string;                         // SHA-256 of the evidence file, also written on-chain with the score
};
export type RegistryStats = {
  total: number; with_profile: number; with_endpoint: number; with_skills: number;
  sati?: { total: number; with_profile: number; with_endpoint: number; synced_at: string };
};
export type Length = "short" | "medium" | "long";
export type Reasoning = "light" | "standard" | "high";
export type RunSource = "web" | "mcp" | "cli";
/** What the user picks before a run. Word ranges and research depth match backend/app/config.py (LENGTHS, REASONING). */
export const LENGTHS: { id: Length; label: string; hint: string; about: string }[] = [
  { id: "short", label: "Short", hint: "~80 words", about: "A direct answer and one paragraph: 60 to 100 words" },
  { id: "medium", label: "Medium", hint: "~200 words", about: "A direct answer and 2 to 4 paragraphs: 150 to 300 words" },
  { id: "long", label: "Long", hint: "~450 words", about: "A direct answer and 4 to 6 paragraphs: 350 to 500 words" },
];
export const REASONINGS: { id: Reasoning; label: string; hint: string; about: string }[] = [
  { id: "light", label: "Light", hint: "fastest", about: "2 sub-questions, up to 3 claims each, quick model reasoning" },
  { id: "standard", label: "Standard", hint: "balanced", about: "3 sub-questions, up to 5 claims each" },
  { id: "high", label: "High", hint: "most detail", about: "4 sub-questions, up to 7 claims each, more model reasoning, and the answer explains how the facts connect" },
];
export type Run = {
  run_id: string; question: string; started_at: string; finished_at?: string; mode: string; error?: string;
  length?: Length; reasoning?: Reasoning; source?: RunSource;
  registry: RegistryStats | null; plan: string[]; tasks: Task[]; hiring: Hiring[]; team: Partial<Record<Role, Member[]>>;
  claims: Claim[]; answer: string | null; written_by_name?: string; failovers: Failover[]; dead: string[]; feedback: Feedback[];
  timings?: Partial<Record<string, number>>; calls?: Call[]; kill?: { agent: string; at_ms: number } | null; round_trip_ms?: number | null;
  metrics: Partial<{
    claims: number; claims_tagged_pct: number; claims_supported: number; bad_agents_rejected: string;
    third_party_tried: number; third_party_passed: number; failovers: number; failover_ms: number | null; feedback_written: string;
  }>;
};
export type ValidationRow = {
  claim_id?: string; claim?: string; quote?: string; source_url?: string; verdict?: string;
  produced_by?: string; verified_by?: string; reason?: string; [k: string]: unknown;
};
export type Compare = {
  rows: { question: string; baseline_used: number; baseline_unsupported: number; ours_used: number; ours_unsupported: number }[];
  mode?: string;
};
export type RunSummary = { id: string; question: string; started_at: string; finished_at: string | null; error: string | null; supported: string | null; claims: string | null };
export type Clarify = { clear: true } | { clear: false; ask: string; options: { label: string; question: string }[] };

export const STEPS: [string, string][] = [
  ["Hire", "screen every candidate"],
  ["Plan", "split the question"],
  ["Retrieve", "fetch sources"],
  ["Read", "extract facts"],
  ["Reason", "state claims"],
  ["Verify", "a second agent checks"],
  ["Generate", "answer from checked facts"],
  ["Record", "scores go on-chain"],
];

/** Index of the first unfinished step (8 = all done), following the graph's order. */
export function progress(r: Run): number {
  if (!ROLES.every((role) => r.team?.[role])) return 0;
  if (!r.plan.length) return 1;
  if (r.tasks.some((t) => !t.sources)) return 2;
  if (r.tasks.some((t) => !t.facts)) return 3;
  if (r.tasks.some((t) => !t.reasoned_by)) return 4;
  if (r.claims.some((c) => c.status === "pending")) return 5;
  if (!r.answer || r.error) return 6;
  if (!r.finished_at) return 7;
  return 8;
}

/** How much of the run is done, 0 to 100, and what it is doing now. Each step is weighted by roughly how long it
 * takes; steps made of many small jobs (screening candidates, checking claims) also count progress within the step. */
export function percent(r: Run): { pct: number; doing: string } {
  const frac = (done: number, all: number) => (all ? done / all : 0);
  const screened = r.hiring.filter((h) => h.result !== "checking").length;
  const tasks = r.tasks.length;
  const checked = r.claims.filter((c) => c.status !== "pending").length;
  const parts: [number, number, string][] = [ // [weight, fraction done, what it is doing]
    [25, ROLES.every((role) => r.team?.[role]) ? 1 : frac(screened, r.hiring.length), `Screening candidates · ${screened} of ${r.hiring.length || "…"} checked`],
    [5, r.plan.length ? 1 : 0, "Planning the question"],
    [10, frac(r.tasks.filter((t) => t.sources).length, tasks), "Finding sources"],
    [10, frac(r.tasks.filter((t) => t.facts).length, tasks), "Reading the sources"],
    [15, frac(r.tasks.filter((t) => t.reasoned_by).length, tasks), "Stating claims"],
    [20, r.answer || (tasks && r.tasks.every((t) => t.reasoned_by) && checked === r.claims.length) ? 1 : frac(checked, r.claims.length), `Verifying claims · ${checked} of ${r.claims.length} checked`],
    [10, r.answer ? 1 : 0, "Writing the answer"],
    [5, r.finished_at ? 1 : 0, "Writing scores on-chain"],
  ];
  let pct = 0;
  let doing = "Done";
  for (const [weight, done, what] of parts) {
    pct += weight * Math.min(1, done);
    if (done < 1 && doing === "Done") doing = what;
  }
  if (r.finished_at) return { pct: r.error ? Math.round(pct) : 100, doing: r.error ? "Stopped" : "Done" };
  return { pct: Math.min(99, Math.round(pct)), doing };
}

/** 1234 -> "1.23 s", 65400 -> "1 min 05 s" */
export function secs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** Total time from asking to the finished record; live runs count up from started_at. */
export const roundTrip = (r: Run, now = Date.now()) =>
  r.round_trip_ms ?? (r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : now - Date.parse(r.started_at));

export const deadSet = (r: Run) => new Set([...(r.dead ?? []), ...r.failovers.map((f) => f.from)]);
/** "Penicillin" for a Wikipedia article, the site name ("tomshardware.com") for any other page. */
export function sourceName(url?: string) {
  if (!url) return "source";
  if (url.includes("/wiki/")) return decodeURIComponent(url.split("/wiki/")[1]).replace(/_/g, " ");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
export const citedIds = (answer?: string | null) => [...(answer ?? "").matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
export const seconds = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
export const explorer = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

export async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const askClarify = (question: string, notFound: boolean) =>
  // Any error (a refused question included) counts as clear: starting the run then shows the refusal itself.
  postJson("/api/clarify", { question, notFound }).then((x) => (x.ok ? x.json() as Promise<Clarify> : { clear: true as const })).catch((): Clarify => ({ clear: true }));
