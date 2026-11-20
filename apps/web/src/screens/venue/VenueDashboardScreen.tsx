"use client";

import type { ReactNode } from "react";
import { parseUsdc } from "@vouch/shared";
import {
  AmountDisplay,
  AppBar,
  AppFrame,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  List,
  ListItem,
  MoneyGraph,
  Screen,
  SectionLabel,
  SegmentedControl,
  Skeleton,
  Stat,
  type MoneyGraphData,
} from "@/components/ui";
import { cn } from "@/design/cn";
import { formatMoney } from "@/design/money";

/* ------------------------------------------------------------------ contract ------------------------------------- */

/** Live-update connection to `GET /events/venue/:venue` (SSE). */
export type LiveStatus = "live" | "connecting" | "reconnecting" | "offline";

/** One settled payment at this venue (from `payment.settled` + its `reward.paid` lines). */
export interface VenuePaymentItem {
  /** orderId; the same id as the MoneyGraph `paymentId`. */
  id: string;
  customerName: string;
  /** What the customer paid. */
  amount: bigint;
  /** What the venue received (PaymentSettled.venueAmount). */
  venueAmount: bigint;
  /** Welcome cashback back to the customer. */
  cashback: bigint;
  /** Σ recommender + introducer rewards. */
  thankedAmount: bigint;
  /** Distinct people paid as recommender / introducer. */
  thankedCount: number;
  firstVisit: boolean;
  /** Pre-formatted, e.g. "now", "2 min", "9:41". */
  time: string;
  /** Just arrived: animates in. */
  fresh?: boolean;
}

export interface VenueDashboardStats {
  /** `verifiedCustomers` from /venues/:venue/stats. */
  verifiedCustomers: number;
  rewardsPaid: bigint;
  /** `costPerVerifiedCustomer`; null before the first verified customer. */
  costPerVerified: bigint | null;
  /** Σ first-purchase amounts (optional). */
  salesFromRecommendations?: bigint;
}

export interface VenueDashboardProps {
  venueName: string;
  status: LiveStatus;
  stats: VenueDashboardStats;
  /** The "typical ad cost per new customer" input, as typed (dollars, e.g. "20.00"). Caller stores it. */
  typicalAdCost: string;
  onTypicalAdCostChange?: (value: string) => void;
  /** Newest first. Empty = brand-new venue (empty state). */
  payments: VenuePaymentItem[];
  /** Money graph input (see MoneyGraph). */
  graph?: MoneyGraphData;
  /** Usually the newest payment id; drives the arrival animation. */
  highlightPaymentId?: string;
  graphMode?: "payment" | "network";
  onGraphModeChange?: (mode: "payment" | "network") => void;
  /** First load: skeletons instead of numbers. */
  loading?: boolean;
  /** Phone footer action ("Take an order") and empty-state action. */
  onNewOrder?: () => void;
  /** Link to the public "how payments split" page. */
  transparencyHref?: string;
  /** `auto` = phone below 1024px, projector layout from 1024px. */
  layout?: "auto" | "phone" | "wide";
  /** Who is looking (MSG-119). "visitor" (not the owner) words rows as "to Lena's café" instead of "to you" and
   *  doesn't speak to the owner about their ad spend. Default "owner". */
  viewer?: "owner" | "visitor";
}

/* ------------------------------------------------------------------ helpers -------------------------------------- */

function parseDollars(s: string): bigint | null {
  try {
    const v = parseUsdc(s.trim().replace(/^\$/, "").replace(/,/g, ""));
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** Below one cent, a "× less" ratio is noise ("About 20000000× less", MSG-101). */
const ONE_CENT = parseUsdc("0.01");
/** Above this the ratio reads as a gimmick; the dollar difference says enough. */
const MAX_RATIO = 100;

/** Plain-words comparison of what a new customer cost vs a typical ad. */
export function adComparison(costPerVerified: bigint | null, typicalAdCost: string): string {
  const ad = parseDollars(typicalAdCost);
  if (costPerVerified === null) return "You'll see this after your first new customer.";
  if (ad === null) return "Enter what an ad usually costs you per new customer to compare.";
  if (costPerVerified < ONE_CENT) return `Almost nothing so far: under a cent per new customer, against ${formatMoney(ad)} for a typical ad.`;
  if (costPerVerified < ad) {
    const times = Number((ad * 10n) / costPerVerified) / 10;
    const x = times >= 2 && times <= MAX_RATIO ? ` About ${times >= 10 ? Math.round(times) : times.toFixed(1)}× less.` : "";
    return `${formatMoney(ad - costPerVerified)} less per new customer than a typical ad.${x}`;
  }
  return "About what an ad costs, but you only pay when they buy.";
}

export function paymentLine(p: VenuePaymentItem): string {
  if (!p.firstVisit) return "Repeat visit, no reward";
  if (p.thankedCount === 0) return p.cashback > 0n ? `First visit · ${formatMoney(p.cashback)} back to ${p.customerName}` : "First visit";
  const people = p.thankedCount === 1 ? "1 person" : `${p.thankedCount} people`;
  return `${formatMoney(p.thankedAmount)} to ${people} who sent ${p.customerName}`;
}

function LiveBadge({ status }: { status: LiveStatus }) {
  if (status === "live")
    return (
      <span role="status" className="inline-flex h-7 items-center gap-2 rounded-full bg-primary-soft px-3 text-caption font-semibold text-primary-ink">
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        Live
      </span>
    );
  if (status === "offline")
    return (
      <Badge tone="danger" className="h-7 px-3">
        <span role="status" className="inline-flex items-center gap-1.5">
          <Icon name="wifiOff" size={14} /> Offline
        </span>
      </Badge>
    );
  return (
    <Badge tone={status === "reconnecting" ? "warning" : "neutral"} className="h-7 px-3">
      <span role="status" className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-3 animate-vx-spin rounded-full border-2 border-current border-r-transparent" />
        {status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
      </span>
    </Badge>
  );
}

function StatusNote({ status }: { status: LiveStatus }) {
  if (status !== "reconnecting" && status !== "offline") return null;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2.5 text-body-sm",
        status === "offline" ? "bg-danger-soft text-danger-ink" : "bg-warning-soft text-warning-ink",
      )}
    >
      <Icon name={status === "offline" ? "wifiOff" : "clock"} size={18} className="mt-0.5 shrink-0" />
      <p>
        {status === "offline"
          ? "Can't reach live updates. Payments still go through; numbers will catch up when you're back online."
          : "Live updates paused for a moment. Numbers may be a few seconds behind."}
      </p>
    </div>
  );
}

function AdCostInput({ p, className }: { p: VenueDashboardProps; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-11 items-center gap-1 rounded-md bg-surface px-2.5 shadow-[inset_0_0_0_1px_var(--vx-line-strong)] focus-within:shadow-[inset_0_0_0_2px_var(--vx-focus)]",
        className,
      )}
    >
      <span className="text-body-sm text-ink-3">$</span>
      <input
        inputMode="decimal"
        aria-label="Typical ad cost per new customer, in dollars"
        value={p.typicalAdCost}
        onChange={(e) => p.onTypicalAdCostChange?.(e.target.value)}
        readOnly={!p.onTypicalAdCostChange}
        className="vx-field-input money h-full w-full min-w-0 bg-transparent text-right text-body font-semibold text-ink outline-none"
      />
    </span>
  );
}

function CostValue({ p, size }: { p: VenueDashboardProps; size: "xl" | "display" }) {
  const cpvc = p.stats.costPerVerified;
  if (p.loading) return <Skeleton className="h-10 w-28" />;
  if (cpvc === null) return <span className="money text-title-1 text-ink-3">—</span>;
  if (cpvc < ONE_CENT)
    return (
      <span className="flex items-baseline gap-1.5">
        <span className="text-body font-medium text-ink-2">under</span>
        <AmountDisplay value={ONE_CENT} size={size} />
      </span>
    );
  return <AmountDisplay value={cpvc} size={size} />;
}

function costSentence(p: VenueDashboardProps) {
  const cpvc = p.stats.costPerVerified;
  if (p.viewer === "visitor")
    return cpvc === null ? "No new customers from recommendations yet." : `What ${p.venueName} has paid in rewards, on average, for each new customer.`;
  return adComparison(cpvc, p.typicalAdCost);
}

function CostCard({ p, wide }: { p: VenueDashboardProps; wide?: boolean }) {
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-body-sm font-medium text-ink-2">Cost per new customer</span>
          <CostValue p={p} size={wide ? "display" : "xl"} />
          <span className="text-caption text-ink-3">paid only when they buy</span>
        </div>
        {p.viewer === "visitor" ? null : (
          <label className="flex w-[7.5rem] shrink-0 flex-col gap-1 text-right">
            <span className="text-caption font-medium text-ink-3">Typical ad cost</span>
            <AdCostInput p={p} />
          </label>
        )}
      </div>
      <p aria-live="polite" className="border-t border-line pt-3 text-body-sm text-ink-2">
        {p.loading ? <Skeleton className="h-4 w-48" /> : costSentence(p)}
      </p>
    </Card>
  );
}

function StatRow({ p }: { p: VenueDashboardProps }) {
  const s = p.stats;
  const v = (n: ReactNode) => (p.loading ? <Skeleton className="h-8 w-16" /> : n);
  return (
    <div data-kpi className="grid grid-cols-2 gap-x-4">
      {/* verifiedCustomers counts every verified first purchase, recommended or not (QE-3-04). */}
      <Stat label="New customers" value={v(s.verifiedCustomers)} caption="verified first purchases" />
      <Stat label="Rewards paid" value={v(<AmountDisplay value={s.rewardsPaid} size="xl" />)} caption="to customers + the people who sent them" />
    </div>
  );
}

function Feed({ payments, max, toLabel = "to you" }: { payments: VenuePaymentItem[]; max?: number; toLabel?: string }) {
  const list = max ? payments.slice(0, max) : payments;
  return (
    <List label="Payments, newest first">
      {list.map((f) => (
        <li key={f.id} className={f.fresh ? "animate-vx-rise-in" : undefined}>
          <ListItem
            leading={<Avatar name={f.customerName} />}
            title={`${f.customerName} paid ${formatMoney(f.amount)}`}
            meta={`${paymentLine(f)} · ${f.time}`}
            trailing={<AmountDisplay value={f.venueAmount} />}
            trailingMeta={toLabel}
          />
        </li>
      ))}
    </List>
  );
}

function GraphEmpty({ onNewOrder, compact }: { onNewOrder?: () => void; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "py-6" : "py-10")}>
      <EmptyState
        icon="users"
        title="No new customers yet"
        body="When a recommended customer pays, you'll see the money reach everyone who sent them, right here."
        action={
          onNewOrder ? (
            <Button variant="secondary" leadingIcon="qr" onClick={onNewOrder}>
              Take an order
            </Button>
          ) : undefined
        }
      />
      <ol className="mt-2 grid max-w-[34rem] gap-3 text-left text-body-sm text-ink-2 sm:grid-cols-3">
        {[
          ["Show your code", "Key in the order. The customer scans and pays."],
          ["They recommend you", "Paying customers can send friends to you."],
          ["Pay only for results", "When a friend buys, part of it thanks whoever sent them."],
        ].map(([t, b], i) => (
          <li key={t} className="flex gap-2.5 rounded-md bg-primary-soft p-3">
            <span className="money flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-caption font-semibold text-on-primary">{i + 1}</span>
            <span>
              <span className="block font-semibold text-ink">{t}</span>
              {b}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GraphModeToggle({ p }: { p: VenueDashboardProps }) {
  if (!p.onGraphModeChange) return null;
  return (
    <SegmentedControl
      label="Money graph view"
      value={p.graphMode ?? "payment"}
      onChange={p.onGraphModeChange}
      options={[
        { value: "payment", label: "Latest" },
        { value: "network", label: "Everyone" },
      ]}
    />
  );
}

function latestCaption(p: VenueDashboardProps) {
  const hl = p.payments.find((x) => x.id === p.highlightPaymentId) ?? p.payments[0];
  return hl ? `${hl.customerName} · ${hl.time}` : null;
}

/* ------------------------------------------------------------------ layouts -------------------------------------- */

function PhoneLayout(p: VenueDashboardProps) {
  const empty = !p.loading && p.payments.length === 0;
  return (
    <Screen
      header={<AppBar title={p.venueName} large trailing={<LiveBadge status={p.status} />} />}
      footer={
        p.onNewOrder ? (
          <Button block size="lg" leadingIcon="qr" onClick={p.onNewOrder}>
            Take an order
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <StatusNote status={p.status} />
        <CostCard p={p} />
        <Card padding="lg">
          <StatRow p={p} />
        </Card>
      </div>
      <SectionLabel action={<GraphModeToggle p={p} />}>Where the money went</SectionLabel>
      <Card padding="sm">
        {p.loading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : empty || !p.graph ? (
          <GraphEmpty compact />
        ) : (
          <>
            <MoneyGraph data={p.graph} highlightPaymentId={p.highlightPaymentId} mode={p.graphMode ?? "payment"} orientation="portrait" className="h-auto w-full" />
            <p className="px-2 pb-1 text-caption text-ink-3">{latestCaption(p)}</p>
          </>
        )}
      </Card>
      {!empty ? (
        <>
          <SectionLabel>Payments</SectionLabel>
          {p.loading ? (
            <div className="flex flex-col gap-3 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <Feed payments={p.payments} max={8} toLabel={p.viewer === "visitor" ? "to the venue" : undefined} />
          )}
        </>
      ) : null}
      {p.transparencyHref ? (
        <a href={p.transparencyHref} className="focus-ring mt-4 flex min-h-12 items-center justify-between rounded-md text-body-sm font-semibold text-primary-ink underline-offset-4 hover:underline">
          How payments split
          <Icon name="chevronRight" size={18} />
        </a>
      ) : null}
    </Screen>
  );
}

/** Projector KPI tile: label, one big number, one plain line. */
function KpiTile({ label, value, caption, className, children }: { label: string; value: ReactNode; caption?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg bg-surface px-5 py-4 shadow-1 ring-1 ring-line/70", className)}>
      <span className="text-body-sm font-semibold text-ink-2">{label}</span>
      <span className="money text-display leading-none text-ink">{value}</span>
      {caption ? <span className="text-body-sm text-ink-3">{caption}</span> : null}
      {children}
    </div>
  );
}

function WideKpis({ p }: { p: VenueDashboardProps }) {
  const s = p.stats;
  const v = (n: ReactNode) => (p.loading ? <Skeleton className="h-12 w-24" /> : n);
  return (
    <div data-kpi className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.55fr)] gap-4">
      {/* verifiedCustomers counts every verified first purchase, recommended or not (QE-3-04). */}
      <KpiTile label="New customers" value={v(s.verifiedCustomers)} caption="verified first purchases" />
      <KpiTile label="Rewards paid" value={v(<AmountDisplay value={s.rewardsPaid} size="display" />)} caption="to customers + the people who sent them" />
      <KpiTile label="Cost per new customer" value={<CostValue p={p} size="display" />}>
        <div className="flex items-center gap-3">
          <p aria-live="polite" className="min-w-0 flex-1 text-body-sm text-ink-2">
            {p.loading ? <Skeleton className="h-4 w-40" /> : costSentence(p)}
          </p>
          {p.viewer === "visitor" ? null : (
            <label className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-caption font-medium text-ink-3">Typical ad cost</span>
              <AdCostInput p={p} className="w-[6.5rem]" />
            </label>
          )}
        </div>
      </KpiTile>
    </div>
  );
}

/** Projector layout: fits one screen (1280×720 and up) with no page scroll. KPIs on top, the money graph as the
 *  hero, the live feed down the right edge (≥ 5 rows visible at 1280×720; the card scrolls for more). */
function WideLayout(p: VenueDashboardProps) {
  const empty = !p.loading && p.payments.length === 0;
  return (
    <div className="h-dvh min-h-[640px] overflow-hidden bg-canvas px-10 xl:px-12">
      <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col gap-4 py-5">
        <header className="flex shrink-0 items-center gap-4">
          <Avatar name={p.venueName} kind="venue" size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title-1 text-ink">{p.venueName}</h1>
            <p className="text-body-sm text-ink-3">New customers from recommendations, live</p>
          </div>
          {p.transparencyHref ? (
            <a
              href={p.transparencyHref}
              className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-body-sm font-semibold text-primary-ink hover:bg-primary-soft"
            >
              How payments split
              <Icon name="chevronRight" size={16} />
            </a>
          ) : null}
          <LiveBadge status={p.status} />
        </header>
        <StatusNote status={p.status} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,370px)] gap-5">
          <div className="flex min-h-0 flex-col gap-4">
            <WideKpis p={p} />
            <Card padding="lg" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-title-3 text-ink">Where the money went</h2>
                  {!empty ? (
                    <p className="truncate text-body-sm text-ink-3">{(p.graphMode ?? "payment") === "payment" ? latestCaption(p) : "Everyone, all time"}</p>
                  ) : null}
                </div>
                <GraphModeToggle p={p} />
              </div>
              <div className="relative min-h-0 flex-1">
                {p.loading ? (
                  <Skeleton className="absolute inset-0 mt-3" />
                ) : empty || !p.graph ? (
                  <div className="absolute inset-0 overflow-y-auto">
                    <GraphEmpty onNewOrder={p.onNewOrder} compact />
                  </div>
                ) : (
                  <MoneyGraph
                    data={p.graph}
                    highlightPaymentId={p.highlightPaymentId}
                    mode={p.graphMode ?? "payment"}
                    orientation="landscape"
                    className="absolute inset-0 h-full w-full"
                  />
                )}
              </div>
            </Card>
          </div>
          <Card padding="md" className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex shrink-0 items-baseline justify-between px-1 pb-1">
              <h2 className="text-title-3 text-ink">Payments</h2>
              {!empty && !p.loading ? <span className="text-caption text-ink-3">newest first</span> : null}
            </div>
            {p.loading ? (
              <div className="flex flex-col gap-3 py-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : empty ? (
              <p className="px-1 py-3 text-body-sm text-ink-3">Payments appear here the moment they land.</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-1" tabIndex={0} aria-label="Payments, scroll for more">
                <Feed payments={p.payments} max={20} toLabel={p.viewer === "visitor" ? "to the venue" : undefined} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Venue owner's dashboard. One component, two layouts: phone (<1024px) and projector (≥1024px, 1280×720 safe).
 * Props-only; FRONTEND_INTEGRATION feeds it from `/venues/:venue/stats` + `GET /events/venue/:venue`.
 */
export function VenueDashboardScreen(p: VenueDashboardProps) {
  const layout = p.layout ?? "auto";
  if (layout === "phone")
    return (
      <AppFrame>
        <PhoneLayout {...p} />
      </AppFrame>
    );
  if (layout === "wide") return <WideLayout {...p} />;
  return (
    <>
      <div className="flex min-h-full flex-1 flex-col lg:hidden">
        <AppFrame>
          <PhoneLayout {...p} />
        </AppFrame>
      </div>
      <div className="hidden min-h-full flex-1 flex-col lg:flex">
        <WideLayout {...p} />
      </div>
    </>
  );
}

/** @deprecated v0 name: the projector layout. Use `<VenueDashboardScreen layout="wide"/>`. */
export function VenueDashboardDesktop(p: VenueDashboardProps) {
  return <VenueDashboardScreen {...p} layout="wide" />;
}
