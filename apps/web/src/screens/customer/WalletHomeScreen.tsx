import { AmountDisplay, AppBar, Avatar, Button, Card, List, ListItem, Screen, SectionLabel } from "@/components/ui";

export interface ActivityItem {
  id: string;
  title: string;
  meta: string;
  /** Signed base units: negative = you paid, positive = money in. */
  amount: bigint;
  /** Small line under the amount, e.g. "+$0.45 back". */
  note?: string;
  kind: "payment" | "reward" | "cashback" | "topup";
  avatarName?: string;
}

export interface WalletHomeScreenProps {
  name: string;
  balance: bigint;
  /** Money earned from recommendations + cashback, this week. */
  earnedThisWeek?: bigint;
  activity: ActivityItem[];
  /** A venue you can now recommend (you're a verified customer). */
  canRecommend?: { venueName: string };
  onScan?: () => void;
  onTopUp?: () => void;
  onRecommend?: () => void;
}

export function WalletHomeScreen({ name, balance, earnedThisWeek, activity, canRecommend, onScan, onTopUp, onRecommend }: WalletHomeScreenProps) {
  return (
    <Screen
      header={<AppBar leading={<span className="pl-3"><Avatar name={name} size="sm" /></span>} />}
      footer={
        <Button block size="lg" leadingIcon="scan" onClick={onScan}>
          Scan to pay
        </Button>
      }
    >
      <section aria-label="Balance" className="pt-4 pb-2">
        <p className="text-body-sm font-medium text-ink-2">Balance</p>
        <AmountDisplay value={balance} size="display" as="p" className="mt-1" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {earnedThisWeek ? (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-3 text-caption font-medium text-accent-ink">
              <AmountDisplay value={earnedThisWeek} variant="positive" size="sm" /> this week
            </span>
          ) : null}
          <Button size="sm" variant="secondary" leadingIcon="plus" onClick={onTopUp}>
            Top up (testnet demo)
          </Button>
        </div>
      </section>

      {canRecommend ? (
        <Card tone="accent" className="mt-5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-ink">Liked {canRecommend.venueName}?</p>
            <p className="text-caption text-ink-2">Recommend it. When a friend makes their first purchase, part of it comes to you.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onRecommend}>
            Recommend
          </Button>
        </Card>
      ) : null}

      <SectionLabel>Recent</SectionLabel>
      <List label="Recent activity">
        {activity.map((a) => (
          <li key={a.id}>
            <ListItem
              leading={<Avatar name={a.avatarName ?? a.title} kind={a.kind === "payment" ? "venue" : "person"} />}
              title={a.title}
              meta={a.meta}
              trailing={<AmountDisplay value={a.amount} variant="signed" />}
              trailingMeta={a.note}
            />
          </li>
        ))}
      </List>
    </Screen>
  );
}
