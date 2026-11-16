import { formatMoney } from "@/design/money";
import { initials } from "./Avatar";

/**
 * Money graph: ONE payment, drawn as money flowing out of the customer's purchase to the venue and
 * back up the referral chain (customer → referrers → their introducers). DESIGN MOCK in Phase 1:
 * props-only, deterministic layout, no data fetching. FRONTEND_INTEGRATION feeds it from
 * PaymentSettled + RewardPaid (viaReferrer draws the L2 edges). See docs/design/DESIGN_SYSTEM.md
 * for the 5 / 20 / 60-node behavior.
 */
export interface MoneyGraphReferrer {
  name: string;
  amount: bigint;
  introducer?: { name: string; amount: bigint };
}

export interface MoneyGraphProps {
  venue: { name: string; amount: bigint };
  customer: { name: string; cashback: bigint };
  referrers: MoneyGraphReferrer[]; // ≤ 5 (MAX_REFERRERS)
  total: bigint;
  /** `projector` 16:9 for the venue dashboard on a big screen; `compact` for a phone card. */
  size?: "projector" | "compact";
  /** Dashes travel along edges toward recipients. Static under reduced motion. */
  animated?: boolean;
  className?: string;
  title?: string;
}

type Pt = { x: number; y: number };

function width(amount: bigint, total: bigint, max: number) {
  if (total === 0n) return 2;
  const f = Number((amount * 10_000n) / total) / 10_000;
  return 2 + max * Math.sqrt(f);
}

function curve(a: Pt, b: Pt, bend = 0.25) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // control point offset perpendicular to the chord
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 } };
}

export function MoneyGraph({ venue, customer, referrers, total, size = "projector", animated = true, className, title }: MoneyGraphProps) {
  const P = size === "projector";
  const W = P ? 1200 : 600;
  const H = P ? 640 : 620;
  const R = P ? 34 : 30; // person node radius
  const font = P ? 20 : 22;
  const maxEdge = P ? 30 : 26;

  const V: Pt = { x: W / 2, y: P ? 96 : 92 };
  const C: Pt = { x: W / 2, y: H - (P ? 120 : 130) };

  const left = referrers.filter((_, i) => i % 2 === 0);
  const right = referrers.filter((_, i) => i % 2 === 1);
  const place = (list: MoneyGraphReferrer[], side: -1 | 1) =>
    list.map((r, i) => {
      const spread = list.length === 1 ? 0.5 : i / (list.length - 1);
      const x = W / 2 + side * (P ? 170 + spread * 230 : 120 + spread * 70);
      const y = (P ? H * 0.55 : H * 0.6) - spread * (P ? 120 : 150);
      const pos = { x, y };
      const intro = r.introducer
        ? P
          ? { x: x + side * 190, y: y - 135 }
          : { x: Math.max(R + 8, Math.min(W - R - 8, x + side * 70)), y: y - 190 }
        : null;
      return { r, pos, intro };
    });
  const nodes = [...place(left, -1), ...place(right, 1)];

  const label = (p: Pt, name: string, amount: bigint, dy: number, tone: "accent" | "ink") => (
    <g>
      <text x={p.x} y={p.y + dy} textAnchor="middle" fontSize={font} fontWeight={600} fill="var(--vx-ink)">
        {name}
      </text>
      <text
        x={p.x}
        y={p.y + dy + font * 1.15}
        textAnchor="middle"
        fontSize={font * 0.9}
        fontWeight={600}
        fill={tone === "accent" ? "var(--vx-accent-ink)" : "var(--vx-ink-2)"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {tone === "accent" ? "+" : ""}
        {formatMoney(amount)}
      </text>
    </g>
  );

  const person = (p: Pt, name: string, ring?: boolean) => (
    <g>
      {ring ? <circle cx={p.x} cy={p.y} r={R + 7} fill="none" stroke="var(--vx-accent)" strokeWidth={3} /> : null}
      <circle cx={p.x} cy={p.y} r={R} fill="var(--vx-surface)" stroke="var(--vx-line-strong)" strokeWidth={1.5} />
      <text x={p.x} y={p.y + font * 0.36} textAnchor="middle" fontSize={font} fontWeight={600} fill="var(--vx-ink)">
        {initials(name)}
      </text>
    </g>
  );

  const edge = (d: string, w: number, tone: "accent" | "venue", key: string) => (
    <g key={key}>
      <path d={d} fill="none" stroke={tone === "accent" ? "var(--vx-accent-4)" : "var(--vx-surface-3)"} strokeWidth={w} strokeLinecap="round" />
      {animated ? (
        <path
          d={d}
          fill="none"
          stroke={tone === "accent" ? "var(--vx-accent)" : "var(--vx-line-strong)"}
          strokeWidth={Math.max(2, w * 0.35)}
          strokeLinecap="round"
          className="vx-flow"
        />
      ) : null}
    </g>
  );

  const venueEdge = curve(C, V, 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        title ??
        `${customer.name} paid ${formatMoney(total)}. ${venue.name} received ${formatMoney(venue.amount)}. ${customer.name} got ${formatMoney(customer.cashback)} back. ` +
          referrers
            .map((r) => `${r.name} earned ${formatMoney(r.amount)}${r.introducer ? `, ${r.introducer.name} earned ${formatMoney(r.introducer.amount)}` : ""}`)
            .join(". ")
      }
      className={className}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* edges first */}
      {edge(venueEdge.d, width(venue.amount, total, maxEdge), "venue", "venue")}
      {nodes.map(({ r, pos, intro }) => (
        <g key={`e-${r.name}`}>
          {edge(curve(C, pos, nodesBend(pos.x, W)).d, width(r.amount, total, maxEdge), "accent", `c-${r.name}`)}
          {intro && r.introducer ? edge(curve(pos, intro, 0.12 * Math.sign(pos.x - W / 2)).d, width(r.introducer.amount, total, maxEdge), "accent", `i-${r.name}`) : null}
        </g>
      ))}
      {/* cashback loop back to the customer */}
      <path
        d={`M ${C.x + R * 0.7} ${C.y + R * 0.7} C ${C.x + R * 3.2} ${C.y + R * 3}, ${C.x - R * 3.2} ${C.y + R * 3}, ${C.x - R * 0.7} ${C.y + R * 0.7}`}
        fill="none"
        stroke="var(--vx-accent)"
        strokeWidth={Math.max(3, width(customer.cashback, total, maxEdge) * 0.6)}
        strokeLinecap="round"
        className={animated ? "vx-flow" : undefined}
      />

      {/* venue node */}
      <g>
        <rect x={V.x - R * 1.25} y={V.y - R * 1.25} width={R * 2.5} height={R * 2.5} rx={R * 0.7} fill="var(--vx-ink)" />
        <text x={V.x} y={V.y + font * 0.4} textAnchor="middle" fontSize={font * 1.1} fontWeight={600} fill="var(--vx-on-ink)">
          {initials(venue.name)}
        </text>
        <text x={V.x + R * 1.25 + 14} y={V.y - 4} fontSize={font} fontWeight={600} fill="var(--vx-ink)">
          {venue.name}
        </text>
        <text x={V.x + R * 1.25 + 14} y={V.y + font} fontSize={font * 0.9} fontWeight={600} fill="var(--vx-ink-2)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(venue.amount)}
        </text>
      </g>

      {/* referrers + introducers */}
      {nodes.map(({ r, pos, intro }) => (
        <g key={`n-${r.name}`}>
          {person(pos, r.name)}
          {label(pos, r.name, r.amount, R + font * 1.1, "accent")}
          {intro && r.introducer ? (
            <g>
              {person(intro, r.introducer.name)}
              {label(intro, r.introducer.name, r.introducer.amount, -R - font * 1.6, "accent")}
            </g>
          ) : null}
        </g>
      ))}

      {/* customer */}
      {person(C, customer.name, true)}
      <text x={C.x + R + 18} y={C.y - 4} fontSize={font} fontWeight={600} fill="var(--vx-ink)">
        {customer.name} paid {formatMoney(total)}
      </text>
      <text x={C.x + R + 18} y={C.y + font} fontSize={font * 0.9} fontWeight={600} fill="var(--vx-accent-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>
        +{formatMoney(customer.cashback)} back
      </text>
    </svg>
  );
}

function nodesBend(x: number, W: number) {
  return x < W / 2 ? 0.18 : -0.18;
}
