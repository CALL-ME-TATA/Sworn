import { deadSet, ROLES, ROUNDS, type Hiring as H, type Run } from "@/lib/run";
import { H2, PlayerMeta, SwapIcon } from "./bits";

const ROUND_LABEL = { reputation: "Reputation", alive: "Alive", trial: "Trial" } as const;
const seen = new Map<string, string>(); // cell key -> state, so only newly cleared rounds animate

/** State of one round for one candidate, from the stage it reached and its result. */
function roundState(h: H, round: string) {
  const order = [...ROUNDS, "hired"];
  const at = order.indexOf(h.stage), i = order.indexOf(round);
  if (i < at) return "pass";
  if (i > at) return "idle";
  if (h.result === "failed") return "fail";
  if (h.stage === "hired") return "pass";
  return "now";
}

function Bracket({ r }: { r: Run }) {
  const dead = deadSet(r);
  const groups = ROLES.map((role) => {
    const rows = r.hiring.filter((h) => h.role === role);
    if (!rows.length) return null;
    const team = (r.team?.[role] ?? []).map((t) => t.asset);
    return (
      <div key={role}>
        <div className="role-label">{role}s</div>
        {rows.map((h) => {
          const pos = team.indexOf(h.asset);
          const killed = dead.has(h.asset);
          const why = r.failovers.find((f) => f.from === h.asset);
          const subIn = r.failovers.find((f) => f.to === h.asset);
          const [plate, line] = killed ? ["Killed", why ? `${why.reason} on ${why.task_id}` : "went offline"]
            : subIn ? ["Subbed in", `took over ${subIn.task_id}`]
            : pos === 0 ? ["Starter", "first pick"] : pos > 0 ? ["Bench", `backup ${pos}`] : ["Passed", "awaiting the draft"];
          return (
            <div key={`${h.asset}-${role}`} className={`row ${h.result === "failed" || killed ? "out" : ""}`}>
              <div className="player">
                <div className="name">{h.name}</div>
                <div className="meta"><PlayerMeta h={h} /></div>
              </div>
              {ROUNDS.map((round) => {
                const st = roundState(h, round);
                const key = `${r.run_id}|${h.asset}|${role}|${round}`;
                const fresh = st === "pass" && seen.get(key) !== "pass";
                seen.set(key, st);
                const lbl = ROUND_LABEL[round];
                if (st === "pass") {
                  const res = round === "reputation" ? (h.score != null ? String(h.score) : "new") : round === "alive" ? "live" : "pass";
                  return <div key={round} className={`cell pass ${fresh ? "draw" : ""}`} data-round={lbl}><span className="res">{res}</span></div>;
                }
                if (st === "fail") return <div key={round} className="cell fail" data-round={lbl}><div><div className="out">Out</div><div className="why">{h.reason}</div></div></div>;
                if (st === "now") return <div key={round} className="cell now" data-round={lbl}><span className="res">checking</span></div>;
                return <div key={round} className="cell idle" data-round={lbl} />;
              })}
              {h.stage === "hired"
                ? <div className={`cell hired ${killed ? "killed" : ""}`} data-round="Hired"><div className="plate">{plate}<small>{line}</small></div></div>
                : <div className="cell idle" data-round="Hired" />}
            </div>
          );
        })}
      </div>
    );
  });
  return (
    <div className="bracket">
      <div className="head"><div>Candidate</div>{ROUNDS.map((x) => <div key={x}>{ROUND_LABEL[x]}</div>)}<div>Hired</div></div>
      {groups.some(Boolean) ? groups : <div className="p-4 text-ink-2">Searching the registries for candidates...</div>}
    </div>
  );
}

function Lineup({ r }: { r: Run }) {
  const dead = deadSet(r);
  const byAsset = Object.fromEntries(r.hiring.map((h) => [`${h.asset}|${h.role}`, h]));
  return (
    <aside className="lineup" aria-label="Hired team">
      {ROLES.map((role) => {
        const team = r.team?.[role] ?? [];
        const subs = r.failovers.filter((f) => team.some((t) => t.asset === f.from));
        if (!team.length) {
          return (
            <div key={role} className="slot">
              <div className="role-label">{role}</div>
              <div className="p-4 text-ink-2">{r.finished_at ? "Nobody passed" : "Screening..."}</div>
            </div>
          );
        }
        const live = team.find((t) => !dead.has(t.asset));
        const bench = team.filter((t) => t.asset !== live?.asset && !dead.has(t.asset));
        return (
          <div key={role} className="slot">
            <div className="role-label">{role}</div>
            {live ? (
              <div className="plate-main py-2">
                <div className="name">{live.name}</div>
                <div className="meta"><PlayerMeta h={byAsset[`${live.asset}|${role}`] ?? {}} /></div>
              </div>
            ) : (
              <div className="plate-main lost"><div className="name">No one left</div><div className="meta">every hired {role} went offline</div></div>
            )}
            {subs.map((s) => (
              <div key={s.from} className="border-t border-rule px-4 py-3">
                <div className="flex items-center gap-2 font-display text-xl font-extrabold"><s className="text-red decoration-2">{s.from_name}</s><SwapIcon />{s.to_name}</div>
                {s.reason} on task {s.task_id} · took over in <span className="font-semibold text-blue">{(s.took_ms / 1000).toFixed(2)} s</span>
              </div>
            ))}
            <div className="px-4 pt-2 pb-3 text-base text-ink-2">
              <b className="label-caps mr-2 text-[15px] text-ink">Bench</b>{bench.length ? bench.map((t) => t.name).join(", ") : "none"}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

export function HiringView({ r }: { r: Run }) {
  return (
    <>
      <H2 note="Each candidate holds its row; the blue line carries it through every round it clears">Hiring</H2>
      <p className="-mt-2 mb-3 text-ink-2">
        <b className="label-caps text-[15px] text-ink">Reputation</b> on-chain average; under 40 is out once an agent has 3 ratings ·{" "}
        <b className="label-caps text-[15px] text-ink">Alive</b> its endpoint answers ·{" "}
        <b className="label-caps text-[15px] text-ink">Trial</b> a known-answer task, graded by code
      </p>
      <div className="draft"><Bracket r={r} /><Lineup r={r} /></div>
    </>
  );
}
