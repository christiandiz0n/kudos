import { AppBar, Card, Icon, Screen, SectionLabel, SplitBreakdown, type SplitPart } from "@/components/ui";
import { formatBps, formatMoney } from "@/design/money";

/**
 * Public transparency page (for judges and anyone curious). NOT a primary screen: the exact formula, base units,
 * contract address, explorer links and event names live here. Technical words are allowed.
 */

export interface TransparencyReferrer {
  name: string;
  /** Attribution weight in bps (Σ = 10,000). */
  weightBps: number;
  /** Who introduced this recommender (level 2). Omit → their share returns to the venue. */
  introducer?: string;
}

export interface TransparencyScreenProps {
  venueName: string;
  rewardBps: number;
  termsVersion: number;
  termsSince: string;
  /** Worked example. Computed here with contract arithmetic (D-503/D-504). */
  example: { customer: string; total: bigint; referrers: TransparencyReferrer[] };
  contractAddress: string;
  deployTx?: string;
  deployBlock?: number;
  tokenAddress: string;
  explorerUrl: string;
  network: string;
  chainId: number;
}

const D = 10_000n;

/** Contract-identical split: per-referrer slices, floor 25/55/20, venue gets amount − Σ transferred. */
export function exactSplit(total: bigint, rewardBps: number, refs: TransparencyReferrer[]) {
  const rate = BigInt(rewardBps);
  const rows = refs.map((r) => {
    const w = BigInt(r.weightBps);
    const slice = (total * w * rate) / (D * D);
    return { r, w, slice, cashback: (slice * 2500n) / D, l1: (slice * 5500n) / D, l2: (slice * 2000n) / D, dust: 0n };
  });
  for (const x of rows) x.dust = x.slice - x.cashback - x.l1 - x.l2;
  const cashback = rows.reduce((a, x) => a + x.cashback, 0n);
  const paidL2 = rows.reduce((a, x) => a + (x.r.introducer ? x.l2 : 0n), 0n);
  const returned = rows.reduce((a, x) => a + (x.r.introducer ? 0n : x.l2), 0n);
  const transferred = cashback + rows.reduce((a, x) => a + x.l1, 0n) + paidL2;
  return { rows, pool: rows.reduce((a, x) => a + x.slice, 0n), cashback, returned, venue: total - transferred, transferred };
}

const n = (v: bigint) => v.toLocaleString("en-US");

const EVENTS: Array<[string, string]> = [
  ["TermsUpdated", "the venue's reward rate + minimum order, versioned. Recommendations freeze the version they were made under."],
  ["IntroAccepted", "a customer accepted a recommendation (signed by the recommender, countersigned by the customer)."],
  ["CustomerVerified", "a first purchase: the customer is now verified at this venue, and their introducer is fixed forever."],
  ["PaymentSettled", "one payment: amount, venue amount, reward pool, whether it was rewarded, and which attribution path was used."],
  ["RewardPaid", "one transfer to a person: role 0 cashback, 1 recommender, 2 introducer (viaReferrer draws the money-graph edge)."],
  ["RewardReturned", "a share that went back to the venue: no introducer, a self-payment cycle, or a failed transfer."],
];

function Mono({ children }: { children: string }) {
  return <code className="font-mono text-[0.8125rem] break-all text-ink">{children}</code>;
}

function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="focus-ring flex min-h-12 items-center justify-between gap-3 rounded-md px-1 text-body-sm font-semibold text-primary-ink underline-offset-4 hover:underline">
      {children}
      <Icon name="external" size={18} className="shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function TransparencyScreen(p: TransparencyScreenProps) {
  const ex = exactSplit(p.example.total, p.rewardBps, p.example.referrers);
  const rate = BigInt(p.rewardBps);
  const parts: SplitPart[] = [
    { id: "venue", label: p.venueName, reason: "sale − everything transferred", amount: ex.venue, role: "venue" },
    { id: "cashback", label: p.example.customer, reason: "welcome cashback, 25% of each slice", amount: ex.cashback, role: "you" },
    ...ex.rows.map((x) => ({ id: `l1-${x.r.name}`, label: x.r.name, reason: `recommender, 55% of a ${x.r.weightBps / 100}% slice`, amount: x.l1, role: "referrer" as const })),
    ...ex.rows
      .filter((x) => x.r.introducer)
      .map((x) => ({ id: `l2-${x.r.name}`, label: x.r.introducer!, reason: `introduced ${x.r.name}, 20% of that slice`, amount: x.l2, role: "introducer" as const })),
  ];
  const sum = parts.reduce((a, x) => a + x.amount, 0n);

  return (
    <Screen header={<AppBar title="How payments split" large />}>
      <p className="-mt-1 text-body text-ink-2">
        Every payment at {p.venueName} is split by a public smart contract on {p.network}, in one transaction. Nobody, including
        Kudos and {p.venueName}, can skip a recommender, change the terms a recommendation was made under, or touch the money in
        between.
      </p>

      <SectionLabel>The formula · terms v{p.termsVersion}</SectionLabel>
      <Card padding="none">
        <dl className="divide-y divide-line text-body-sm">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="font-semibold text-ink">Reward rate</dt>
            <dd className="money font-semibold text-ink">
              {formatBps(p.rewardBps)} = {n(rate)} bps <span className="font-normal text-ink-3">since {p.termsSince}</span>
            </dd>
          </div>
          {[
            ["Slice per recommender i", "sliceᵢ = ⌊amount × wᵢ × rate / 10⁸⌋, where wᵢ is the attribution weight in bps (Σw = 10,000)"],
            ["25% of each slice", "⌊slice × 2,500 / 10,000⌋ to the customer as welcome cashback"],
            ["55% of each slice", "⌊slice × 5,500 / 10,000⌋ to recommender i"],
            ["20% of each slice", "⌊slice × 2,000 / 10,000⌋ to whoever introduced recommender i (level 2)"],
            ["Venue", "amount − Σ everything actually transferred"],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-3">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card tone="sunken" padding="md" className="mt-3 text-body-sm text-ink-2">
        <p className="font-semibold text-ink">Rounding rule</p>
        <p className="mt-1">
          Amounts are integer USDC base units (1 unit = $0.000001). Every share is rounded <strong className="text-ink">down</strong>.
          The venue receives the remainder, so rounding dust (at most 2 units per recommender) and any share that can&apos;t be paid
          (no introducer, a self-payment cycle, a failed transfer) go to the venue. Payouts always add up to the sale exactly:
          venueAmount + Σ RewardPaid = amount.
        </p>
      </Card>

      <SectionLabel>Worked example, in base units</SectionLabel>
      <p className="mb-2 text-body-sm text-ink-2">
        {p.example.customer}&apos;s first purchase: {formatMoney(p.example.total)} = {n(p.example.total)} units, at {formatBps(p.rewardBps)}.{" "}
        {p.example.referrers.map((r) => `${r.name} ${r.weightBps / 100}%`).join(", ")}.
      </p>
      {/* Keyboard users can scroll the table: named, focusable, brand focus ring (QE F5: was the UA amber outline). */}
      <Card padding="none" className="focus-ring overflow-x-auto" tabIndex={0} role="region" aria-label="Worked example table, scrolls sideways">

        <table className="w-full min-w-[22rem] text-left text-body-sm">
          <thead className="text-caption text-ink-3">
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 font-medium">Line</th>
              <th scope="col" className="px-2 py-2 font-medium">Formula</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Units</th>
            </tr>
          </thead>
          <tbody className="money divide-y divide-line text-ink-2">
            {ex.rows.map((x) => (
              <tr key={`s-${x.r.name}`}>
                <th scope="row" className="px-4 py-2 font-semibold text-ink">Slice {x.r.name}</th>
                <td className="px-2 py-2">
                  ⌊{n(p.example.total)} × {n(x.w)} × {n(rate)} / 10⁸⌋
                </td>
                <td className="px-4 py-2 text-right text-ink">{n(x.slice)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-2 font-semibold text-ink">Cashback {p.example.customer}</th>
              <td className="px-2 py-2">{ex.rows.map((x) => `⌊${n(x.slice)} × 25%⌋`).join(" + ")}</td>
              <td className="px-4 py-2 text-right text-accent-ink">{n(ex.cashback)}</td>
            </tr>
            {ex.rows.map((x) => (
              <tr key={`l1-${x.r.name}`}>
                <th scope="row" className="px-4 py-2 font-semibold text-ink">{x.r.name}</th>
                <td className="px-2 py-2">⌊{n(x.slice)} × 55%⌋</td>
                <td className="px-4 py-2 text-right text-accent-ink">{n(x.l1)}</td>
              </tr>
            ))}
            {ex.rows.map((x) => (
              <tr key={`l2-${x.r.name}`}>
                <th scope="row" className="px-4 py-2 font-semibold text-ink">{x.r.introducer ?? `${x.r.name}'s introducer`}</th>
                <td className="px-2 py-2">
                  ⌊{n(x.slice)} × 20%⌋{x.r.introducer ? "" : " → returned to venue"}
                </td>
                <td className="px-4 py-2 text-right text-accent-ink">{n(x.l2)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-2 font-semibold text-ink">{p.venueName}</th>
              <td className="px-2 py-2">
                {n(p.example.total)} − {n(ex.transferred)}
              </td>
              <td className="px-4 py-2 text-right text-ink">{n(ex.venue)}</td>
            </tr>
            <tr className="bg-surface-2">
              <th scope="row" className="px-4 py-2 font-semibold text-ink">Total paid out</th>
              <td className="px-2 py-2">{sum === p.example.total ? "= the sale, exactly" : "mismatch"}</td>
              <td className="px-4 py-2 text-right font-semibold text-ink">{n(sum)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <div className="mt-4">
        <SplitBreakdown total={p.example.total} parts={parts} precision="exact" title="The same payment, in dollars" animate={false} />
      </div>

      <SectionLabel>Verify it yourself</SectionLabel>
      <Card padding="none">
        <dl className="divide-y divide-line">
          {[
            ["Network", `${p.network} · chain id ${p.chainId}`],
            ["Split contract (v3, verified source)", p.contractAddress],
            ...(p.deployBlock ? [["Deployed at block", n(BigInt(p.deployBlock))]] : []),
            ["Payment token (USDC, 6 decimals)", p.tokenAddress],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-3">
              <dt className="text-caption text-ink-3">{k}</dt>
              <dd className="mt-0.5">
                <Mono>{v}</Mono>
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <ul className="mt-2 flex flex-col">
        <li>
          <ExtLink href={`${p.explorerUrl}/address/${p.contractAddress}?tab=contract`}>Read the contract source on Blockscout</ExtLink>
        </li>
        <li>
          <ExtLink href={`${p.explorerUrl}/address/${p.contractAddress}?tab=logs`}>Every event it has emitted</ExtLink>
        </li>
        {p.deployTx ? (
          <li>
            <ExtLink href={`${p.explorerUrl}/tx/${p.deployTx}`}>The deployment transaction</ExtLink>
          </li>
        ) : null}
      </ul>

      <SectionLabel>The events</SectionLabel>
      <Card padding="none">
        <ul className="divide-y divide-line">
          {EVENTS.map(([name, what]) => (
            <li key={name} className="px-4 py-3 text-body-sm">
              <Mono>{name}</Mono>
              <p className="mt-0.5 text-ink-2">{what}</p>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-2 text-caption text-ink-3">Plus setup events: VenueRegistered, VenueKeysUpdated, SeedAmbassadorSet, IntroDropped.</p>

      <SectionLabel>How Streams powers this</SectionLabel>
      <Card tone="primary" padding="md" className="text-body-sm text-ink">
        A QuickNode Stream watches this contract on Arc and pushes every event to our API within seconds (HMAC-signed webhook).
        Dashboards, feeds and the money graph are rebuilt from those events alone; replaying the stream from block{" "}
        {p.deployBlock ? n(BigInt(p.deployBlock)) : "the deploy block"} reproduces them exactly.
      </Card>
    </Screen>
  );
}
