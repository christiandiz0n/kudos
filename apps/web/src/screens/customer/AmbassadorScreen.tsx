/**
 * Ambassador record (UI_DESIGN, Phase 3). Props-only. Built only from real first purchases; owned by the person.
 *
 * PROP CONTRACT (AmbassadorScreenProps)  ← GET /ambassadors/:address
 *   name, verifiedCustomers, venueCount   number of new customers your recommendations brought, across N venues
 *   earned                                bigint base units, all-time from recommendations
 *   venues                                { name, meta, customers, earned }[] (sorted by the caller)
 *   viewer?                               "owner" (default: share + "yours" copy) | "visitor" (someone opened the shared link)
 *   loading?                              skeleton
 *   recordId?                             public record id, shown only inside Details
 *   onShare?, copied?, onBack?
 */
import { AmountDisplay, AppBar, Avatar, Badge, Button, Card, DetailRow, Details, EmptyState, IconButton, List, ListItem, Screen, SectionLabel, Skeleton, SkeletonRow } from "@/components/ui";

export interface AmbassadorVenue {
  name: string;
  meta: string;
  customers: number;
  earned: bigint;
}

export interface AmbassadorScreenProps {
  name: string;
  verifiedCustomers: number;
  venueCount: number;
  earned: bigint;
  venues: AmbassadorVenue[];
  viewer?: "owner" | "visitor";
  loading?: boolean;
  /** Shown only inside Details. */
  recordId?: string;
  copied?: boolean;
  onShare?: () => void;
  onBack?: () => void;
}

/** Ana's ambassador record: hers, portable, built only from real verified purchases. */
export function AmbassadorScreen(p: AmbassadorScreenProps) {
  const owner = (p.viewer ?? "owner") === "owner";
  return (
    <Screen
      header={
        <AppBar
          leading={p.onBack ? <IconButton icon="arrowLeft" label="Back" onClick={p.onBack} /> : undefined}
          title={owner ? "Your record" : `${p.name}'s record`}
          trailing={owner && p.onShare ? <IconButton icon="share" label="Share your record" onClick={p.onShare} /> : undefined}
        />
      }
      footer={
        owner && p.onShare ? (
          <Button block size="lg" leadingIcon={p.copied ? "check" : "share"} onClick={p.onShare}>
            {p.copied ? "Link copied" : "Share my record"}
          </Button>
        ) : undefined
      }
    >
      <section aria-label="Summary" aria-busy={p.loading || undefined} className="pt-2">
        <div className="flex items-center gap-3">
          <Avatar name={p.name} size="lg" />
          <div>
            <p className="text-title-3 text-ink">{p.name}</p>
            <Badge tone="primary">Ambassador</Badge>
          </div>
        </div>
        <Card className="mt-5 animate-vx-rise-in" padding="lg">
          {p.loading ? (
            <>
              <Skeleton className="h-12 w-20" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-6 h-6 w-full" />
            </>
          ) : (
            <>
              <p className="money text-display text-primary-ink">{p.verifiedCustomers}</p>
              <p className="mt-1 text-body text-ink">
                new {p.verifiedCustomers === 1 ? "customer" : "customers"} across <span className="money font-semibold">{p.venueCount}</span>{" "}
                {p.venueCount === 1 ? "venue" : "venues"}
              </p>
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <span className="text-body-sm text-ink-2">Earned from recommendations</span>
                <AmountDisplay value={p.earned} variant="positive" size="lg" />
              </div>
            </>
          )}
        </Card>
        <p className="mt-3 text-caption text-ink-3">
          {owner
            ? "Every number here comes from a real first purchase. Your record belongs to you and goes wherever you go."
            : `Every number here comes from a real first purchase someone made after ${p.name}'s recommendation.`}
        </p>
      </section>

      <SectionLabel>Venues</SectionLabel>
      {p.loading ? (
        <div aria-busy="true">
          <span className="sr-only">Loading venues</span>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : p.venues.length === 0 ? (
        <EmptyState
          icon="users"
          title="No recommendations yet"
          body={owner ? "After you buy somewhere, recommend it. Each friend's first purchase shows up here." : undefined}
          className="py-8"
        />
      ) : (
        <List label="Venues recommended">
          {p.venues.map((v) => (
            <li key={v.name}>
              <ListItem
                leading={<Avatar name={v.name} kind="venue" />}
                title={v.name}
                meta={`${v.customers} new ${v.customers === 1 ? "customer" : "customers"} · ${v.meta}`}
                trailing={<AmountDisplay value={v.earned} variant="positive" />}
              />
            </li>
          ))}
        </List>
      )}

      {p.recordId ? (
        <Details className="mt-6">
          <DetailRow label="Public record" value={p.recordId} mono />
          <DetailRow label="Verified by" value="Purchases settled on Arc" />
        </Details>
      ) : null}
    </Screen>
  );
}
