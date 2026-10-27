import { explorer, FLAG_TEXT, type Hiring } from "@/lib/run";

/** An agent's on-chain identity, linked to Solana Explorer. */
export function Asset({ asset }: { asset?: string }) {
  if (!asset || asset.startsWith("unregistered")) return null;
  return (
    <a href={explorer("address", asset)} target="_blank" rel="noopener" title={`On-chain identity ${asset} (opens Solana Explorer)`}
      className="font-mono text-[11.5px] text-muted">
      {asset.slice(0, 6)}…
    </a>
  );
}

export function Origin({ h }: { h: Partial<Hiring> & { protocol?: string } }) {
  if (h.ours) return <span className="tag tag-gray" title="Registered by our team">ours</span>;
  return (
    <>
      {h.registry === "sati"
        ? <span className="tag tag-blue" title="Third-party agent from the SATI registry">SATI</span>
        : <span className="tag tag-blue" title="Third-party agent from the Solana Agent Registry (8004)">8004</span>}
      {h.protocol === "mcp" && <span className="tag tag-gray" title="Lists an MCP server (a set of tools) rather than a task endpoint">MCP</span>}
    </>
  );
}

/** Independent on-chain reputation; ratings the agent's own operator gave it are left out and only counted. */
export function Rating({ h }: { h: Partial<Hiring> }) {
  // Why ratings were left out, from the fake-reputation detector ("captive wallet 120, burst 4").
  const why = Object.entries(h.ignored ?? {}).map(([k, n]) => `${FLAG_TEXT[k as keyof typeof FLAG_TEXT]?.label ?? k} ${n}`).join(", ");
  const main = h.score != null ? `${h.score} avg · ${h.ratings} independent rating${h.ratings === 1 ? "" : "s"}` : "no independent ratings";
  return (
    <span className="text-[13px] text-muted" title={why || "Ratings from the agent's own operator are self-ratings and do not count"}>
      {main}{h.self_ratings ? ` · ${h.self_ratings} ${h.ignored ? "flagged" : "self-"}ratings ignored` : ""}
    </span>
  );
}

export function Title({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="serif m-0 text-3xl">{children}</h2>
      {note && <p className="mt-2 mb-0 max-w-2xl text-sm text-muted">{note}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-6 py-10 text-center text-muted">{children}</div>;
}

export const verdictTag = (s: string) => (s === "supported" ? "tag-green" : s === "pending" ? "tag-yellow" : "tag-red");
