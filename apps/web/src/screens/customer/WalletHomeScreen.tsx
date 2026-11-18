/**
 * Home: balance + activity (UI_DESIGN, Phase 3). Props-only. ("Wallet" is an internal name only.)
 *
 * PROP CONTRACT (WalletHomeScreenProps)
 *   name                    display name
 *   balance                 bigint base units (GET /me/wallet). Ignored while `loading`.
 *   earnedThisWeek?         bigint: cashback + recommendation rewards in the last 7 days (green chip)
 *   activity                ActivityItem[] newest first (GET /me/activity + SSE). `amount` is signed:
 *                           negative = you paid (ink, "−$12.00"), positive = money in (green, "+$0.45").
 *                           status "pending" rows render muted with a "Pending" tag; settled rows are normal.
 *   loading?                first load: skeleton balance + 3 skeleton rows
 *   offline?                calm banner, keeps showing the last known numbers
 *   canRecommend?           { venueName } → the "Liked Lena's café?" card (only for verified customers)
 *   record?                 { verifiedCustomers, venueCount } → row into the ambassador record
 *   toppingUp?              top-up request in flight
 *   onScan, onTopUp, onRecommend, onOpenRecord, onOpenActivity(id)
 */
import { AmountDisplay, AppBar, Avatar, Badge, Button, Card, EmptyState, Icon, List, ListItem, Screen, SectionLabel, Skeleton, SkeletonRow } from "@/components/ui";
import { cn } from "@/design/cn";

export interface ActivityItem {
  id: string;
  title: string;
  meta: string;
  /** Signed base units: negative = you paid, positive = money in. */
  amount: bigint;
  /** Small line under the amount, e.g. "+$0.45 back". */
  note?: string;
  kind: "payment" | "reward" | "cashback" | "topup";
  /** Default "settled". Pending = sent, waiting for the public record to confirm (a few seconds). */
  status?: "pending" | "settled";
  avatarName?: string;
}

export interface WalletHomeScreenProps {
  name: string;
  balance: bigint;
  /** Money earned from recommendations + cashback, this week. */
  earnedThisWeek?: bigint;
  activity: ActivityItem[];
  loading?: boolean;
  offline?: boolean;
  /** A venue you can now recommend (you're a verified customer). */
  canRecommend?: { venueName: string };
  record?: { verifiedCustomers: number; venueCount: number };
  toppingUp?: boolean;
  onScan?: () => void;
  onTopUp?: () => void;
  onRecommend?: () => void;
  onOpenRecord?: () => void;
  onOpenActivity?: (id: string) => void;
}

function ActivityAvatar({ a }: { a: ActivityItem }) {
  if (a.kind === "topup")
    return (
      <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        <Icon name="plus" size={20} />
      </span>
    );
  return <Avatar name={a.avatarName ?? a.title} kind={a.kind === "payment" ? "venue" : "person"} />;
}

export function WalletHomeScreen({
  name,
  balance,
  earnedThisWeek,
  activity,
  loading,
  offline,
  canRecommend,
  record,
  toppingUp,
  onScan,
  onTopUp,
  onRecommend,
  onOpenRecord,
  onOpenActivity,
}: WalletHomeScreenProps) {
  return (
    <Screen
      header={
        <AppBar
          leading={
            <span className="flex items-center gap-2.5 pl-3">
              <Avatar name={name} size="sm" />
              <span className="text-body font-semibold text-ink">{name}</span>
            </span>
          }
        />
      }
      footer={
        <Button block size="lg" leadingIcon="scan" onClick={onScan}>
          Scan to pay
        </Button>
      }
    >
      {offline ? (
        <p role="status" className="mt-2 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-body-sm text-ink-2">
          <Icon name="wifiOff" size={18} className="shrink-0" />
          You&apos;re offline. Showing your last balance.
        </p>
      ) : null}

      <section aria-label="Balance" aria-busy={loading || undefined} className="pt-4 pb-2">
        <p className="text-body-sm font-medium text-ink-2">Balance</p>
        {loading ? (
          <>
            <span className="sr-only">Loading your balance</span>
            <Skeleton className="mt-3 h-12 w-48" />
            <Skeleton rounded="full" className="mt-4 h-7 w-32" />
          </>
        ) : (
          <>
            <AmountDisplay value={balance} size="display" as="p" className="mt-1" />
            {earnedThisWeek ? (
              <p className="mt-2 flex w-fit h-8 items-center gap-1 rounded-full bg-accent-soft px-3 text-body-sm font-medium text-accent-ink">
                <AmountDisplay value={earnedThisWeek} variant="positive" size="sm" className="font-semibold" /> earned this week
              </p>
            ) : null}
          </>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" variant="secondary" leadingIcon="plus" loading={toppingUp} loadingLabel="Adding…" onClick={onTopUp} disabled={loading || offline}>
            Top up (testnet demo)
          </Button>
          <span className="text-caption text-ink-3">Simulated money for this demo</span>
        </div>
      </section>

      {canRecommend && !loading ? (
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

      {record && !loading ? (
        <List className="mt-3">
          <li>
            <ListItem
              onClick={onOpenRecord}
              chevron
              leading={
                <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                  <Icon name="users" size={20} />
                </span>
              }
              title="Your recommendations"
              meta={`${record.verifiedCustomers} new ${record.verifiedCustomers === 1 ? "customer" : "customers"} across ${record.venueCount} ${record.venueCount === 1 ? "venue" : "venues"}`}
            />
          </li>
        </List>
      ) : null}

      <SectionLabel>Recent</SectionLabel>
      {loading ? (
        <div aria-busy="true">
          <span className="sr-only">Loading recent activity</span>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : activity.length === 0 ? (
        <EmptyState
          icon="scan"
          title="No payments yet"
          body="Scan the code at a Vouch café, barber or salon to pay. Your first visit gives you money back."
          className="py-8"
        />
      ) : (
        <List label="Recent activity">
          {activity.map((a) => {
            const pending = a.status === "pending";
            return (
              <li key={a.id}>
                <ListItem
                  onClick={onOpenActivity ? () => onOpenActivity(a.id) : undefined}
                  leading={<ActivityAvatar a={a} />}
                  title={a.title}
                  meta={a.meta}
                  trailing={<AmountDisplay value={a.amount} variant={pending ? "muted" : "signed"} className={cn(pending && "opacity-80")} />}
                  trailingMeta={
                    pending ? (
                      <Badge className="mt-0.5 h-5 px-2" dot>
                        Pending
                      </Badge>
                    ) : (
                      a.note
                    )
                  }
                />
              </li>
            );
          })}
        </List>
      )}
    </Screen>
  );
}
