import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import { explorer, FLAG_TEXT, type TrustFlag, type TrustReport } from "@/lib/run";

type Raw = TrustReport["graph"];
type N = Raw["nodes"][number] & SimulationNodeDatum;
type L = Omit<Raw["edges"][number], "source" | "target"> & { source: N; target: N };
type Filter = "all" | "flagged" | "clean";

const W = 960, H = 580;
const RULES: TrustFlag[] = ["captive", "burst", "single_source", "ring", "self"];
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const radius = (n: N) => (n.owner ? 4 + Math.min(8, Math.sqrt(n.agents) * 1.7) : 3 + Math.min(6, Math.sqrt(n.ratings_given) / 4));

/** Who rates whom on the registry: rater wallets and the owners whose agents they rate. A live force layout:
 * drag nodes, drag the background to pan, zoom with the buttons or Ctrl + scroll, hover or click for details. */
export function TrustGraph({ g, ours, names }: { g: Raw; ours: Record<string, string>; names: Map<string, string[]> }) {
  const svg = useRef<SVGSVGElement>(null);
  const sim = useRef<Simulation<N, L> | null>(null);
  const [, setTick] = useState(0);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [rule, setRule] = useState<TrustFlag | null>(null);
  const drag = useRef<null | { kind: "node"; n: N; moved: boolean; x0: number; y0: number } | { kind: "pan"; x: number; y: number; vx: number; vy: number }>(null);

  const { nodes, links, byId } = useMemo(() => {
    const nodes: N[] = g.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i) * 40, y: H / 2 + Math.sin(i) * 40 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: L[] = g.edges.map((e) => ({ ...e, source: byId.get(e.source)!, target: byId.get(e.target)! }));
    return { nodes, links, byId };
  }, [g]);

  useEffect(() => {
    const s = forceSimulation<N, L>(nodes)
      .force("link", forceLink<N, L>(links).distance(36).strength(0.5))
      .force("charge", forceManyBody<N>().strength(-55))
      .force("x", forceX<N>(W / 2).strength(0.045))
      .force("y", forceY<N>(H / 2).strength(0.07))
      .force("collide", forceCollide<N>((d) => radius(d) + 2));
    sim.current = s;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      s.stop().tick(300);
      setTick((t) => t + 1);
    } else {
      s.on("tick", () => setTick((t) => t + 1));
    }
    return () => { s.stop(); };
  }, [nodes, links]);

  // Ctrl/Cmd + wheel zooms (plain wheel keeps scrolling the page). Needs a non-passive listener to stop the browser zooming.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = point(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * 0.002), p.x, p.y);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  /** Screen pixels -> SVG viewBox units (before pan and zoom). */
  function point(cx: number, cy: number) {
    const m = svg.current!.getScreenCTM()!.inverse();
    return { x: m.a * cx + m.c * cy + m.e, y: m.b * cx + m.d * cy + m.f };
  }
  function zoomAt(f: number, px = W / 2, py = H / 2) {
    setView((v) => {
      const k = Math.max(0.5, Math.min(5, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }

  function down(e: React.PointerEvent, n?: N) {
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    if (n) {
      const p = point(e.clientX, e.clientY);
      drag.current = { kind: "node", n, moved: false, x0: p.x, y0: p.y };
      n.fx = n.x;
      n.fy = n.y;
      sim.current?.alphaTarget(0.25).restart();
    } else {
      const p = point(e.clientX, e.clientY);
      drag.current = { kind: "pan", x: p.x, y: p.y, vx: view.x, vy: view.y };
    }
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(e.clientX, e.clientY);
    if (d.kind === "node") {
      if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < 4) return; // a click, not a drag
      d.moved = true;
      d.n.fx = (p.x - view.x) / view.k;
      d.n.fy = (p.y - view.y) / view.k;
    } else {
      setView((v) => ({ ...v, x: d.vx + p.x - d.x, y: d.vy + p.y - d.y }));
    }
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "node") {
      d.n.fx = d.n.fy = null;
      sim.current?.alphaTarget(0);
      if (!d.moved) setSelected((s) => (s === d.n.id ? null : d.n.id));
    }
  }

  const active = hover ?? selected;
  const near = useMemo(() => {
    if (!active) return null;
    const s = new Set([active]);
    for (const l of links) if (l.source.id === active || l.target.id === active) { s.add(l.source.id); s.add(l.target.id); }
    return s;
  }, [active, links]);
  const shown = (l: L) => filter === "all" || (filter === "flagged" ? l.flagged : !l.flagged);
  const lit = (l: L) => (active ? l.source.id === active || l.target.id === active : rule ? l.why === rule : true);
  const max = Math.max(...links.map((l) => l.n), 1);
  const ruleCount = (f: TrustFlag) => links.filter((l) => l.why === f).length;

  const label = (n: N) => (ours[n.id] ? `Sworn · ${ours[n.id]}` : null);
  const info = active ? byId.get(active) : null;

  return (
    <figure className="card m-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="inline-flex rounded-md border border-line bg-bone p-0.5 text-[13px]" role="group" aria-label="Links to show">
          {(["all", "flagged", "clean"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 ${filter === f ? "bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-ink"}`}>
              {f === "all" ? "All links" : f === "flagged" ? "Flagged" : "Independent"}
            </button>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        {RULES.filter((f) => ruleCount(f)).map((f) => (
          <button key={f} type="button" aria-pressed={rule === f} title={FLAG_TEXT[f].about}
            onClick={() => { setRule(rule === f ? null : f); setSelected(null); }}
            className={`tag cursor-pointer transition-colors ${rule === f ? "bg-red text-white" : "tag-red hover:bg-red/15"}`}>
            {FLAG_TEXT[f].label} · {ruleCount(f)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Zoom in" onClick={() => zoomAt(1.3)}>+</button>
          <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.3)}>−</button>
          <button type="button" className="btn btn-ghost h-8 px-2.5 text-xs" onClick={() => { setView({ k: 1, x: 0, y: 0 }); setSelected(null); setRule(null); setFilter("all"); sim.current?.alpha(0.6).restart(); }}>Reset</button>
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_270px]">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full cursor-grab touch-none bg-bone/40 select-none active:cursor-grabbing"
          role="img" aria-label={`Graph of the ${links.length} busiest rating links on the registry; red links are mostly flagged ratings`}
          onPointerDown={(e) => { down(e); setSelected(null); }} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {links.filter(shown).map((l, i) => {
              const on = lit(l);
              return (
                <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
                  className={on && (active || rule) && l.flagged ? "graph-flow" : undefined}
                  stroke={l.flagged ? "var(--color-red)" : "var(--color-muted)"}
                  strokeOpacity={on ? (active || rule ? 0.9 : 0.45) : 0.07}
                  strokeWidth={(0.8 + 3.4 * Math.sqrt(l.n / max)) / Math.sqrt(view.k)}
                  style={{ transition: "stroke-opacity 200ms" }}>
                  <title>{`${short(l.source.id)} rated ${short(l.target.id)}'s agents ${l.n} times${l.why ? ` · mostly flagged: ${FLAG_TEXT[l.why].label}` : ""}`}</title>
                </line>
              );
            })}
            {nodes.map((n) => {
              const us = ours[n.id];
              const dim = near ? !near.has(n.id) : rule ? !links.some((l) => l.why === rule && (l.source === n || l.target === n)) : false;
              const r = radius(n) * (n.id === active ? 1.35 : 1);
              const fill = us ? "var(--color-blue)" : n.owner ? "var(--color-ink)" : n.captive ? "var(--color-red)" : "var(--color-card)";
              const ring = n.captive && n.owner ? "var(--color-red)" : us || n.captive || n.owner ? "var(--color-card)" : "var(--color-muted)";
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.15 : 1} style={{ transition: "opacity 200ms", cursor: "pointer" }}
                  onPointerDown={(e) => down(e, n)} onPointerEnter={() => !drag.current && setHover(n.id)} onPointerLeave={() => setHover(null)}>
                  {n.owner
                    ? <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={2.5} fill={fill} stroke={ring} strokeWidth={n.captive ? 2.5 : 1.2} />
                    : <circle r={r} fill={fill} stroke={ring} strokeWidth={1.2} />}
                  {(us || n.id === active) && (
                    <text x={r + 5} y={4} fontSize={12 / Math.sqrt(view.k)} fontFamily="var(--font-mono)" fill={us ? "var(--color-blue)" : "var(--color-ink)"}
                      paintOrder="stroke" stroke="var(--color-canvas)" strokeWidth={3}>
                      {label(n) ?? (names.get(n.id)?.[0] || short(n.id))}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <aside className="border-t border-line p-5 text-sm lg:border-t-0 lg:border-l" aria-live="polite">
          {info ? <Details n={info} links={links} ours={ours} names={names} pinned={selected === info.id} onClose={() => setSelected(null)} /> : (
            <div className="text-muted">
              <p className="mt-0 font-medium text-ink">Explore the registry</p>
              <ul className="m-0 space-y-1.5 pl-4">
                <li>Hover or click a node for its details.</li>
                <li>Drag a node to pull its cluster apart.</li>
                <li>Drag the background to pan; <kbd className="kbd">Ctrl</kbd> + scroll or the buttons to zoom.</li>
                <li>Pick a rule above to light up only the links it flagged.</li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[2px] bg-ink" />agent owner</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[2px] border-2 border-red bg-ink" />owner that is also a captive rater</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full border border-muted bg-card" />rater wallet</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-red" />captive wallet (rates one owner only)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full bg-blue" />our wallets</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-red" />link mostly flagged</span>
        <span>Busiest {links.length} links; line width = number of ratings.</span>
      </figcaption>
    </figure>
  );
}

function Details({ n, links, ours, names, pinned, onClose }: {
  n: N; links: L[]; ours: Record<string, string>; names: Map<string, string[]>; pinned: boolean; onClose: () => void;
}) {
  const out = links.filter((l) => l.source === n).sort((a, b) => b.n - a.n);
  const inc = links.filter((l) => l.target === n).sort((a, b) => b.n - a.n);
  const owned = names.get(n.id) ?? [];
  const role = ours[n.id] ? `Sworn's ${ours[n.id]} wallet` : n.owner && n.rates ? "Owner that also rates" : n.owner ? "Agent owner" : n.captive ? "Captive rater wallet" : "Rater wallet";
  const why = Object.entries(
    [...out, ...inc].reduce<Record<string, number>>((m, l) => (l.why ? { ...m, [l.why]: (m[l.why] ?? 0) + l.n } : m), {}),
  ).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className={`m-0 font-medium ${n.captive ? "text-red" : ours[n.id] ? "text-blue" : "text-ink"}`}>{role}</p>
        {pinned && <button type="button" onClick={onClose} className="text-xs text-muted underline underline-offset-4 hover:text-ink">close</button>}
      </div>
      <a href={explorer("address", n.id)} target="_blank" rel="noopener" className="mt-1 block font-mono text-[11.5px] break-all text-muted">{n.id}</a>
      <dl className="mt-4 mb-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {n.owner && <><dt className="text-muted">Rated agents</dt><dd className="m-0 text-ink">{n.agents}</dd></>}
        {n.rates && <><dt className="text-muted">Ratings given</dt><dd className="m-0 text-ink">{n.ratings_given.toLocaleString()}</dd></>}
        {out.length > 0 && <><dt className="text-muted">Rates owners</dt><dd className="m-0 text-ink">{out.length}{out.length === 1 ? " (only one)" : ""}</dd></>}
        {inc.length > 0 && <><dt className="text-muted">Rated by</dt><dd className="m-0 text-ink">{inc.length} wallet{inc.length === 1 ? "" : "s"}</dd></>}
      </dl>
      {owned.length > 0 && (
        <p className="mb-0 text-[13px] text-muted">Agents: <span className="text-ink-2">{owned.slice(0, 4).join(", ")}{owned.length > 4 ? ` and ${owned.length - 4} more` : ""}</span></p>
      )}
      {why.length > 0 && (
        <div className="mt-4">
          <p className="m-0 text-xs text-muted">Why its links are flagged</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {why.map(([f, c]) => <span key={f} className="tag tag-red" title={FLAG_TEXT[f as TrustFlag].about}>{FLAG_TEXT[f as TrustFlag].label} · {c}</span>)}
          </div>
        </div>
      )}
      {!why.length && (out.length > 0 || inc.length > 0) && <p className="mt-4 mb-0 text-xs text-green">No flagged links in this view.</p>}
    </div>
  );
}
