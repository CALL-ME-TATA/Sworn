import { useEffect, useMemo, useState } from "react";
import { explorer, FLAG_TEXT, getJson, type TrustAgent, type TrustFlag, type TrustReport } from "@/lib/run";
import { Asset, Empty, Title } from "./bits";
import { TrustGraph } from "./TrustGraph";

const FLAGS = Object.keys(FLAG_TEXT).filter((f) => f !== "operator") as TrustFlag[];

const VERDICT = {
  independent: { label: "independent", tone: "tag-green" },
  mostly_flagged: { label: "mostly flagged", tone: "tag-yellow" },
  no_independent: { label: "no independent ratings", tone: "tag-red" },
} as const;

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function Stat({ n, label, tone = "text-ink" }: { n: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="card p-5">
      <div className={`serif text-4xl ${tone}`}>{n}</div>
      <p className="m-0 mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

function Score({ v }: { v: number | null }) {
  return v == null ? <span className="text-faint">–</span> : <span className="font-mono text-xs text-ink">{v.toFixed(0)}</span>;
}

function AgentRow({ a }: { a: TrustAgent }) {
  const v = VERDICT[a.verdict];
  return (
    <tr>
      <td>
        <span className="font-medium text-ink">{a.name || "unnamed agent"}</span> <Asset asset={a.asset} />
        <div className="text-xs text-faint">owner <a href={explorer("address", a.owner)} target="_blank" rel="noopener" className="font-mono">{short(a.owner)}</a></div>
      </td>
      <td className="font-mono text-xs">{a.ratings.toLocaleString()} <span className="text-faint">/ {a.raters} wallet{a.raters === 1 ? "" : "s"}</span></td>
      <td><Score v={a.raw} /></td>
      <td><Score v={a.independent} /> <span className="text-xs text-faint">({a.independent_count})</span></td>
      <td className="text-xs">
        <span className="flex flex-wrap gap-1">
          {FLAGS.filter((f) => a.flags[f]).map((f) => <span key={f} className="tag tag-red" title={FLAG_TEXT[f].about}>{FLAG_TEXT[f].label} {a.flags[f]}</span>)}
          {!FLAGS.some((f) => a.flags[f]) && <span className="text-faint">none</span>}
        </span>
      </td>
      <td><span className={`tag ${v.tone}`}>{v.label}</span></td>
    </tr>
  );
}

/** Every rating on the 8004 registry, checked by the fake-reputation detector. Not tied to a run. */
export function Trust() {
  const [t, setT] = useState<TrustReport | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  useEffect(() => { getJson<TrustReport>("/api/registry/trust").then(setT); }, []);
  // owner wallet -> names of its rated agents, for the graph's details panel
  const names = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of t?.agents ?? []) if (a.name) m.set(a.owner, [...(m.get(a.owner) ?? []), a.name]);
    return m;
  }, [t]);
  if (t === undefined) return <><Title>Registry trust</Title><Empty>Reading every rating on the registry…</Empty></>;
  if (!t) return <><Title>Registry trust</Title><Empty>The registry's ratings are still being read (about two minutes the first time). Check back shortly.</Empty></>;
  const s = t.summary;
  const rows = all ? t.agents : t.agents.slice(0, 25);
  return (
    <>
      <Title note={<>Anyone can rate any agent on the Solana Agent Registry, so a high score says little by itself. Sworn reads every rating on it, flags the ones that don't look like independent customers, and hires on what is left. Read from the registry's indexer, last rating {new Date(s.updated_at * 1000).toLocaleString()}.</>}>
        Registry trust
      </Title>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat n={s.ratings.toLocaleString()} label={`ratings on ${s.agents.toLocaleString()} agents, from ${s.raters} wallets`} />
        <Stat n={`${s.captive_ratings_pct}%`} tone="text-red" label={`of ratings come from ${s.captive_wallets} wallets that only ever rate one owner's agents`} />
        <Stat n={`${s.flagged_pct}%`} tone="text-red" label="of all ratings flagged by at least one rule" />
        <Stat n={(s.verdicts.no_independent ?? 0).toLocaleString()} label={`of ${s.agents.toLocaleString()} rated agents have no independent rating at all`} />
      </div>

      <h3 className="mt-12 mb-4 text-lg font-medium text-ink">The rules</h3>
      <dl className="card m-0 divide-y divide-line">
        {FLAGS.map((f) => (
          <div key={f} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3">
            <dt className="text-sm"><span className="font-medium text-ink">{FLAG_TEXT[f].label}</span> <span className="text-muted">· {FLAG_TEXT[f].about}</span></dt>
            <dd className="m-0 font-mono text-xs text-muted">{s.by_flag[f].toLocaleString()} ratings</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 mb-0 text-xs text-faint">A flag only removes a rating from the independent score. It is not a verdict on the agent: a real customer who only uses one product also looks captive.</p>

      <h3 className="mt-12 mb-4 text-lg font-medium text-ink">Who rates whom</h3>
      <TrustGraph g={t.graph} ours={t.ours ?? {}} names={names} />

      <h3 className="mt-12 mb-4 text-lg font-medium text-ink">Most-rated agents: registry score vs independent score</h3>
      <div className="card overflow-x-auto px-6">
        <table className="tbl min-w-[820px]">
          <thead><tr><th>Agent</th><th>Ratings</th><th>Registry</th><th>Independent</th><th>Flags</th><th>Verdict</th></tr></thead>
          <tbody>{rows.map((a) => <AgentRow key={a.asset} a={a} />)}</tbody>
        </table>
      </div>
      {t.agents.length > 25 && (
        <button type="button" onClick={() => setAll(!all)} className="btn btn-ghost mt-4">{all ? "Show the top 25" : `Show all ${t.agents.length.toLocaleString()} rated agents`}</button>
      )}
    </>
  );
}
