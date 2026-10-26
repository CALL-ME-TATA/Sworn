import { useEffect, useState } from "react";
import { ASPECTS, explorer, getJson, ROLES, type BenchmarkRow } from "@/lib/run";
import { Asset, Empty, Title } from "./bits";

const ABOUT: Record<string, string> = {
  accuracy: "right answer on known-answer items (SQuAD 2.0, HotpotQA, FEVER)",
  grounding: "nothing invented: quotes are on the page, citations are real",
  honesty: "says “not found” or “unsupported” when that is the truth",
  reliability: "calls succeed and come back in the right shape",
  speed: "95th-percentile response time within the job's budget",
};

function Cell({ v }: { v?: number }) {
  if (v == null) return <span className="text-faint" title="Does not apply to this job; the other aspects share its weight">n/a</span>;
  const tone = v >= 80 ? "bg-green" : v >= 60 ? "bg-yellow" : "bg-red";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-bone"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${v}%` }} /></span>
      <span className="font-mono text-xs text-ink">{Math.round(v)}</span>
    </span>
  );
}

/** Latest standard-benchmark result for every agent that has been tested, ours or anyone's. */
export function Benchmarks() {
  const [rows, setRows] = useState<BenchmarkRow[] | null>(null);
  useEffect(() => { getJson<BenchmarkRow[]>("/api/benchmarks").then(setRows); }, []);
  return (
    <>
      <Title note="The same test for every agent in a job: the same items, the same five equally weighted aspects, graded by code, never by an AI. Items come from public datasets and are re-checked against today's Wikipedia. 60/100 is needed to be hired. Self-ratings never count.">
        Standard benchmark <span className="tag tag-gray align-middle">sab-v1</span>
      </Title>
      <dl className="mb-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {ASPECTS.map((a) => (
          <div key={a}><dt className="inline font-medium text-ink capitalize">{a}</dt> <dd className="inline text-muted">· {ABOUT[a]}</dd></div>
        ))}
      </dl>
      {!rows ? <Empty>Loading results…</Empty> : !rows.length ? <Empty>No agent has been benchmarked yet. Results appear after the next run.</Empty> : (
        <div className="space-y-6">
          {ROLES.map((role) => {
            const list = rows.filter((x) => x.role === role);
            if (!list.length) return null;
            return (
              <section key={role} className="card overflow-hidden">
                <header className="border-b border-line bg-bone/50 px-6 py-3 font-medium text-ink capitalize">{role}</header>
                <div className="overflow-x-auto px-6">
                  <table className="tbl min-w-[860px]">
                    <thead><tr><th>Agent</th><th>Score</th>{ASPECTS.map((a) => <th key={a}>{a}</th>)}<th>Tested</th><th>Record</th></tr></thead>
                    <tbody>
                      {list.map((x) => (
                        <tr key={x.id}>
                          <td><span className="font-medium text-ink">{x.name}</span> <Asset asset={x.asset} /></td>
                          <td><span className={`tag ${x.score >= 60 ? "tag-green" : "tag-red"}`}>{Math.round(x.score)}/100</span></td>
                          {ASPECTS.map((a) => <td key={a}><Cell v={x.aspects[a]} /></td>)}
                          <td className="font-mono text-xs text-muted">{x.day}</td>
                          <td className="space-x-3 text-xs whitespace-nowrap">
                            <a href={`/api/benchmarks/${x.id}`} target="_blank" rel="noopener">report</a>
                            {x.tx ? <a href={explorer("tx", x.tx)} target="_blank" rel="noopener">on-chain</a> : <span className="text-faint">not yet on-chain</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
