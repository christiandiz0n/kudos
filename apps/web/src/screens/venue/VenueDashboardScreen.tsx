import type { ReactNode } from "react";
import { AmountDisplay, AppBar, Avatar, Badge, Card, List, ListItem, MoneyGraph, Screen, SectionLabel, Stat, type MoneyGraphProps } from "@/components/ui";

export interface FeedItem {
  id: string;
  who: string;
  title: string;
  meta: string;
  amount: bigint;
  /** "venue" amounts are plain, reward amounts are green. */
  kind: "sale" | "reward" | "verified";
  fresh?: boolean;
}

export interface VenueDashboardProps {
  venueName: string;
  verifiedCustomers: number;
  costPerVerified: bigint;
  rewardsPaid: bigint;
  salesFromRecommendations: bigint;
  feed: FeedItem[];
  /** The latest rewarded payment, drawn as a money graph. */
  graph?: Omit<MoneyGraphProps, "size">;
}

function FeedList({ feed }: { feed: FeedItem[] }) {
  return (
    <List label="Live activity">
      {feed.map((f) => (
        <li key={f.id} className={f.fresh ? "animate-vx-rise-in" : undefined}>
          <ListItem
            leading={<Avatar name={f.who} />}
            title={f.title}
            meta={f.meta}
            trailing={<AmountDisplay value={f.amount} variant={f.kind === "sale" ? "plain" : "positive"} />}
          />
        </li>
      ))}
    </List>
  );
}

function Stats({ p, wide }: { p: VenueDashboardProps; wide?: boolean }): ReactNode {
  return (
    <div className={wide ? "grid grid-cols-2 gap-x-6 gap-y-6" : "grid grid-cols-2 gap-x-4 gap-y-5"}>
      <Stat label="Cost per new customer" value={<AmountDisplay value={p.costPerVerified} size="xl" />} caption="paid only when they buy" />
      <Stat label="Verified new customers" value={p.verifiedCustomers} caption="via recommendations" />
      <Stat label="Rewards paid" value={<AmountDisplay value={p.rewardsPaid} size="xl" />} caption="to customers + recommenders" />
      <Stat label="Sales they brought" value={<AmountDisplay value={p.salesFromRecommendations} size="xl" />} caption="first purchases" />
    </div>
  );
}

/** Venue owner's phone view. */
export function VenueDashboardScreen(p: VenueDashboardProps) {
  return (
    <Screen header={<AppBar title={p.venueName} large trailing={<Badge tone="accent" dot>Live</Badge>} />}>
      <Card padding="lg">
        <Stats p={p} />
      </Card>
      {p.graph ? (
        <>
          <SectionLabel>Latest payment</SectionLabel>
          <Card padding="sm">
            <MoneyGraph {...p.graph} size="compact" className="h-auto w-full" />
          </Card>
        </>
      ) : null}
      <SectionLabel>Live</SectionLabel>
      <FeedList feed={p.feed} />
    </Screen>
  );
}

/** Desktop / projector view: graph left at hero size, numbers + feed right. */
export function VenueDashboardDesktop(p: VenueDashboardProps) {
  return (
    <div className="flex min-h-full flex-col bg-canvas px-10 py-8">
      <header className="flex items-center gap-4">
        <Avatar name={p.venueName} kind="venue" size="lg" />
        <div className="flex-1">
          <h1 className="text-title-1 text-ink">{p.venueName}</h1>
          <p className="text-body-sm text-ink-3">Recommendations, live</p>
        </div>
        <Badge tone="accent" dot>
          Live
        </Badge>
      </header>
      <div className="mt-8 grid flex-1 grid-cols-[minmax(0,1fr)_380px] gap-8">
        <Card padding="lg" className="flex flex-col">
          <div className="flex items-baseline justify-between">
            <h2 className="text-title-3 text-ink">Latest payment</h2>
            <span className="text-body-sm text-ink-3">Ben · just now</span>
          </div>
          {p.graph ? <MoneyGraph {...p.graph} size="projector" className="mt-4 h-auto w-full flex-1" /> : null}
        </Card>
        <div className="flex flex-col gap-6">
          <Card padding="lg">
            <Stats p={p} wide />
          </Card>
          <Card padding="md">
            <h2 className="px-1 text-body-sm font-semibold text-ink-2">Live</h2>
            <FeedList feed={p.feed} />
          </Card>
        </div>
      </div>
    </div>
  );
}
