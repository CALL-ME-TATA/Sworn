import { explorer, type Hiring } from "@/lib/run";

/** An agent's on-chain identity, linked to Solana Explorer. */
export function Asset({ asset }: { asset?: string }) {
  if (!asset || asset.startsWith("unregistered")) return null;
  return (
    <a href={explorer("address", asset)} target="_blank" rel="noopener" title={`On-chain identity ${asset} (opens Solana Explorer)`}>
      <code>{asset.slice(0, 6)}…</code>
    </a>
  );
}

export function PlayerMeta({ h }: { h: Partial<Hiring> }) {
  const rating = h.score != null ? `${h.score} avg · ${h.ratings} rating${h.ratings === 1 ? "" : "s"}` : "no ratings yet";
  const [cls, label, tip] = h.ours
    ? ["", "Ours", "Registered by our team"]
    : h.registry === "sati"
      ? ["third", "SATI", "Third-party agent from the SATI registry (cascade-protocol/sati)"]
      : ["third", "Third-party", "Third-party agent from the Solana Agent Registry (8004)"];
  return (
    <>
      <span className={`tag ${cls}`} title={tip}>{label}</span>
      <span>{rating}</span>
      <Asset asset={h.asset} />
    </>
  );
}

export function H2({ children, note, id }: { children: React.ReactNode; note?: React.ReactNode; id?: string }) {
  return (
    <h2 className="h2" id={id}>
      {children}
      {note && <small>{note}</small>}
    </h2>
  );
}

export const SwapIcon = () => (
  <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
    <path d="M1 7h14M10 2l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" />
  </svg>
);
