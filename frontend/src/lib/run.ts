// Shape of a run report (backend/app/orchestrator.py) and small helpers shared by the views.

export const ROLES = ["planner", "retriever", "reader", "reasoner", "verifier", "generator"] as const;
export type Role = (typeof ROLES)[number];
export const ROUNDS = ["reputation", "alive", "trial"] as const;

export type Hiring = {
  asset: string; name: string; role: Role; ours: boolean; registry: "8004" | "sati";
  stage: "reputation" | "alive" | "trial" | "hired"; result: "checking" | "passed" | "failed";
  reason: string | null; score: number | null; ratings: number;
};
export type Member = { asset: string; name: string };
export type Task = {
  id: string; question: string; search: string; planned_by_name?: string;
  sources?: { title: string; url: string }[]; retrieved_by_name?: string;
  facts?: unknown[]; read_by_name?: string; reasoned_by?: string; reasoned_by_name?: string;
};
export type Claim = {
  id: string; sub_question: string; text: string; quote: string; source_url: string;
  retrieved_by_name?: string; read_by_name?: string; produced_by: string; produced_by_name: string;
  verified_by?: string; verified_by_name?: string; status: "pending" | "supported" | "unsupported" | "unreachable"; reason?: string | null;
};
export type Failover = { role: Role; from: string; from_name: string; to: string; to_name: string; task_id: string; reason: string; took_ms: number };
export type Feedback = { asset: string; name: string; role: Role; ours: boolean; registry: string; score: number; outcome: string; tx?: string; error?: string };
export type RegistryStats = {
  total: number; with_profile: number; with_endpoint: number; with_skills: number;
  sati?: { total: number; with_profile: number; with_endpoint: number; synced_at: string };
};
export type Run = {
  run_id: string; question: string; started_at: string; finished_at?: string; mode: string; error?: string;
  registry: RegistryStats | null; plan: string[]; tasks: Task[]; hiring: Hiring[]; team: Partial<Record<Role, Member[]>>;
  claims: Claim[]; answer: string | null; written_by_name?: string; failovers: Failover[]; dead: string[]; feedback: Feedback[];
  metrics: Partial<{
    claims: number; claims_tagged_pct: number; claims_supported: number; bad_agents_rejected: string;
    third_party_tried: number; third_party_passed: number; failovers: number; failover_ms: number | null; feedback_written: string;
  }>;
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

export const deadSet = (r: Run) => new Set([...(r.dead ?? []), ...r.failovers.map((f) => f.from)]);
export const sourceName = (url?: string) => decodeURIComponent((url ?? "").split("/wiki/")[1] ?? "source").replace(/_/g, " ");
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
  postJson("/api/clarify", { question, notFound }).then((x) => x.json() as Promise<Clarify>).catch((): Clarify => ({ clear: true }));
