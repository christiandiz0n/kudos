import { AppBar, Card, Icon, Screen, SectionLabel, SplitBreakdown, type SplitPart } from "@/components/ui";
import { formatBps } from "@/design/money";

export interface TransparencyScreenProps {
  venueName: string;
  rewardBps: number;
  termsVersion: number;
  termsSince: string;
  example: { total: bigint; parts: SplitPart[] };
  contractAddress: string;
  explorerUrl: string;
  tokenAddress: string;
  network: string;
}

const RULES: Array<[string, string]> = [
  ["Reward pool", "sale × reward rate"],
  ["25% of the pool", "to the customer (welcome cashback)"],
  ["55% of the pool", "to the direct recommenders, split by attribution weight (max 5, no one above 80% unless alone)"],
  ["20% of the pool", "to whoever introduced each recommender, same proportions"],
  ["Anything unclaimed", "returns to the venue (e.g. a recommender with no introducer)"],
  ["Rounding", "integer units (1 = $0.000001); payouts always add up exactly to the sale"],
];

/**
 * Public transparency page (not a primary screen): this is where the exact formula, contract
 * address and explorer links live. Technical words are allowed here.
 */
export function TransparencyScreen(p: TransparencyScreenProps) {
  return (
    <Screen header={<AppBar title="How payments split" large />}>
      <p className="-mt-1 text-body text-ink-2">
        Every payment at {p.venueName} is split by a public contract, in one transaction. Nobody, including Vouch and{" "}
        {p.venueName}, can skip a recommender or change the terms of a recommendation already made.
      </p>

      <SectionLabel>The formula · terms v{p.termsVersion}</SectionLabel>
      <Card padding="none">
        <dl className="divide-y divide-line">
          <div className="flex items-baseline justify-between px-4 py-3">
            <dt className="text-body-sm font-semibold text-ink">Reward rate</dt>
            <dd className="money text-body font-semibold text-ink">
              {formatBps(p.rewardBps)} <span className="text-caption font-normal text-ink-3">since {p.termsSince}</span>
            </dd>
          </div>
          {RULES.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-3">
              <dt className="text-body-sm font-semibold text-ink">{k}</dt>
              <dd className="text-body-sm text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <SectionLabel>Worked example, exact</SectionLabel>
      <SplitBreakdown total={p.example.total} parts={p.example.parts} precision="exact" title="First purchase" animate={false} />

      <SectionLabel>Verify it yourself</SectionLabel>
      <Card padding="none">
        <dl className="divide-y divide-line">
          {[
            ["Network", p.network],
            ["Split contract", p.contractAddress],
            ["Payment token (USDC)", p.tokenAddress],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-3">
              <dt className="text-caption text-ink-3">{k}</dt>
              <dd className="mt-0.5 font-mono text-[0.8125rem] break-all text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <ul className="mt-3 flex flex-col gap-1">
        {[
          ["View the contract on the explorer", `${p.explorerUrl}/address/${p.contractAddress}`],
          ["See every payment it has split", `${p.explorerUrl}/address/${p.contractAddress}?tab=logs`],
        ].map(([label, href]) => (
          <li key={label}>
            <a href={href} target="_blank" rel="noreferrer" className="focus-ring flex min-h-12 items-center justify-between rounded-md px-1 text-body-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
              {label}
              <Icon name="external" size={18} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
