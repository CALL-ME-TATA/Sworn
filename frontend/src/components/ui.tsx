"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/** Fades its children in once they scroll into view. */
export function Reveal({ children, i = 0, className = "", as: Tag = "div" }: { children: React.ReactNode; i?: number; className?: string; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.classList.add("in");
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    // @ts-expect-error - ref type differs per tag, all are HTMLElements
    <Tag ref={ref} className={`reveal ${className}`} style={{ "--i": i } as React.CSSProperties}>{children}</Tag>
  );
}

const paths: Record<string, React.ReactNode> = {
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 3.8" /><circle cx="12" cy="17.2" r=".6" fill="currentColor" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.3-4.4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3" /><path d="M8.5 8.5h6" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0 0 12 3z" /></>,
  checks: <><path d="m3.5 12.5 4 4 8-9" /><path d="m11 16.5 1 0 8-9" /></>,
  pen: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  chain: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  swap: <><path d="M4 8h14l-4-4M20 16H6l4 4" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.4a6.5 6.5 0 0 1 3.5 5.6" /></>,
  arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bolt: <><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" /></>,
  db: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
};

/** Bold-stroke icons drawn inline (no icon library). */
export function Icon({ name, size = 20, className = "" }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 text-ink no-underline">
      <svg width={small ? 20 : 22} height={small ? 20 : 22} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#111" />
        <path d="m7.5 12.2 3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="serif text-[22px] leading-none">Sworn</span>
    </Link>
  );
}

/** Minimal window chrome for product mock-ups. */
export function Window({ children, title, className = "" }: { children: React.ReactNode; title?: string; className?: string }) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line bg-card px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#e3e2de]" /><span className="size-2.5 rounded-full bg-[#e3e2de]" /><span className="size-2.5 rounded-full bg-[#e3e2de]" />
        {title && <span className="ml-3 font-mono text-[11px] text-muted">{title}</span>}
      </div>
      {children}
    </div>
  );
}
