import { roundTrip, secs, type Run } from "@/lib/run";
import { Empty, Title } from "./bits";
import { Icon } from "./ui";

/* ---------- failover record (kill demo) ---------- */

export function FailoverRecord({ r }: { r: Run }) {
  if (!r.kill && !r.failovers.length) return null;
  return (
    <div className="card mt-4 overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-bone/50 px-6 py-3">
        <p className="m-0 flex items-center gap-2 font-medium text-ink"><Icon name="swap" size={16} className="text-yellow" />Failover record</p>
        <p className="m-0 text-xs text-muted">{r.kill ? "kill switch used on this run" : "an agent failed during this run"}</p>
      </header>
      {r.failovers.length === 0 ? (
        <p className="m-0 px-6 py-5 text-sm text-muted">
          {r.kill ? `${r.kill.agent} was switched off ${secs(r.kill.at_ms)} into the run, ` : ""}
          {r.finished_at ? "but no task was sent to it afterwards, so no backup was needed." : "waiting for its next task…"}
        </p>
      ) : r.failovers.map((f) => {
        const detailed = f.fail_ms != null && f.switch_ms != null && f.backup_ms != null;
        const total = detailed ? Math.max(1, f.fail_ms! + f.switch_ms! + f.backup_ms!) : 1;
        return (
          <div key={f.from} className="px-6 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="m-0 text-ink">
                <span className="text-muted line-through">{f.from_name}</span>{" "}
                <Icon name="arrow" size={13} className="inline align-[-1px] text-faint" />{" "}
                <span className="font-medium">{f.to_name}</span>
                <span className="text-muted"> · {f.role} · task {f.task_id}</span>
              </p>
              <p className="m-0"><span className="eyebrow mr-2">Takeover</span><span className="serif text-3xl">{secs(f.took_ms)}</span></p>
            </div>
            {detailed && (
              <>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-line" role="img"
                  aria-label={`Failed after ${secs(f.fail_ms)}, switched in ${secs(f.switch_ms)}, backup took ${secs(f.backup_ms)}`}>
                  <div className="bg-red" style={{ width: `${(100 * f.fail_ms!) / total}%`, minWidth: 3 }} />
                  <div className="bg-yellow" style={{ width: `${(100 * f.switch_ms!) / total}%`, minWidth: 3 }} />
                  <div className="bg-green" style={{ width: `${(100 * f.backup_ms!) / total}%` }} />
                </div>
                <ol className="m-0 mt-4 grid list-none gap-2 p-0 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {r.kill && <Moment at={r.kill.at_ms} dot="bg-ink" label={`${r.kill.agent} switched off`} />}
                  <Moment at={f.failed_at_ms} dot="bg-red" label={`Its call failed after ${secs(f.fail_ms)} (${f.reason})`} />
                  <Moment at={f.failed_at_ms! + f.switch_ms!} dot="bg-yellow" label={`${f.to_name} called ${secs(f.switch_ms)} later`} />
                  <Moment at={f.recovered_at_ms} dot="bg-green" label={`${f.to_name} finished the task in ${secs(f.backup_ms)}`} />
                </ol>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Moment({ at, dot, label }: { at?: number; dot: string; label: string }) {
  return (
    <li className="rounded-lg border border-line px-3 py-2.5">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted"><span className={`size-1.5 rounded-full ${dot}`} />{at != null ? `${secs(at)} into the run` : ""}</span>
      <span className="mt-1 block text-ink">{label}</span>
    </li>
  );
}

/* ---------- timing tab ---------- */

const STEP_ORDER = ["hire", "plan", "retrieve", "read", "reason", "verify", "generate", "record"];

export function Timing({ r }: { r: Run }) {
  const t = r.timings ?? {};
  const calls = r.calls ?? [];
  if (!Object.keys(t).length && !calls.length) {
    return <><Title>Timing</Title><Empty>Timing is recorded for runs started after the timing update. Start a new run to see it.</Empty></>;
  }
  const longest = Math.max(1, ...STEP_ORDER.map((s) => t[s] ?? 0));
  const timed = calls.filter((c) => c.ms != null);
  const slowest = Math.max(1, ...timed.map((c) => c.ms!));
  const stats: [string, string][] = [
    ["Agent calls", String(calls.length)],
    ["Failed calls", String(calls.filter((c) => !c.ok && c.ms != null).length)],
    ["Average call", timed.length ? secs(timed.reduce((a, c) => a + c.ms!, 0) / timed.length) : "—"],
    ["Slowest call", timed.length ? secs(slowest) : "—"],
  ];
  return (
    <>
      <Title note="Round trip is the time from asking the question to the last score written on-chain. Every agent call is timed from request to reply.">Timing</Title>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="card flex flex-col justify-between gap-6 p-6 sm:p-8">
          <div>
            <p className="eyebrow mb-2">Round trip</p>
            <p className="serif m-0 text-5xl">{secs(roundTrip(r))}</p>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-4 text-sm">
            {stats.map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="m-0 mt-1 text-ink">{v}</dd></div>)}
          </dl>
        </div>
        <div className="card p-6 sm:p-8">
          <p className="eyebrow mb-4">Time per step</p>
          <ul className="m-0 list-none space-y-2.5 p-0">
            {STEP_ORDER.map((s) => (
              <li key={s} className="grid grid-cols-[72px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
                <span className="text-ink capitalize">{s}</span>
                <span className="h-2 overflow-hidden rounded-full bg-bone"><span className="block h-full rounded-full bg-ink" style={{ width: `${(100 * (t[s] ?? 0)) / longest}%` }} /></span>
                <span className="text-right font-mono text-xs text-muted">{t[s] != null ? secs(t[s]) : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {calls.length > 0 && (
        <div className="card mt-4 px-6 py-2">
          <div className="overflow-x-auto">
            <table className="tbl min-w-[600px]">
              <thead><tr><th>At</th><th>Role</th><th>Agent</th><th>Task</th><th>Round trip</th><th /></tr></thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs text-muted">{secs(c.at_ms)}</td>
                    <td className="text-muted capitalize">{c.role}</td>
                    <td className="text-ink">{c.agent}</td>
                    <td className="font-mono text-xs text-muted">{c.task_id}</td>
                    <td>
                      <span className="flex items-center gap-3">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-bone">
                          <span className={`block h-full rounded-full ${c.ok ? "bg-ink" : "bg-red"}`} style={{ width: `${(100 * (c.ms ?? 0)) / slowest}%` }} />
                        </span>
                        <span className="font-mono text-xs text-ink">{c.ms != null ? secs(c.ms) : "running"}</span>
                      </span>
                    </td>
                    <td>{!c.ok && c.ms != null && <span className="tag tag-red" title={c.error}>{c.error ?? "failed"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
