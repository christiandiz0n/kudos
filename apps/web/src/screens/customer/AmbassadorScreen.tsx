import { AmountDisplay, AppBar, Avatar, Badge, Card, DetailRow, Details, IconButton, List, ListItem, Screen, SectionLabel } from "@/components/ui";

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
  /** Shown only inside Details. */
  recordId?: string;
  onBack?: () => void;
}

/** Ana's ambassador record: hers, portable, built only from real verified purchases. */
export function AmbassadorScreen(p: AmbassadorScreenProps) {
  return (
    <Screen header={<AppBar leading={<IconButton icon="arrowLeft" label="Back" onClick={p.onBack} />} title="Your record" />}>
      <section aria-label="Summary" className="pt-2">
        <div className="flex items-center gap-3">
          <Avatar name={p.name} size="lg" />
          <div>
            <p className="text-title-3 text-ink">{p.name}</p>
            <Badge tone="accent">Ambassador</Badge>
          </div>
        </div>
        <Card className="mt-5" padding="lg">
          <p className="money text-display text-ink">{p.verifiedCustomers}</p>
          <p className="mt-1 text-body text-ink">
            verified customers across <span className="money font-semibold">{p.venueCount}</span> venues
          </p>
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-body-sm text-ink-2">Earned from recommendations</span>
            <AmountDisplay value={p.earned} variant="positive" size="lg" />
          </div>
        </Card>
        <p className="mt-3 text-caption text-ink-3">
          Every number here comes from a real first purchase. Your record belongs to you and goes wherever you go.
        </p>
      </section>

      <SectionLabel>Venues</SectionLabel>
      <List label="Venues you recommended">
        {p.venues.map((v) => (
          <li key={v.name}>
            <ListItem
              leading={<Avatar name={v.name} kind="venue" />}
              title={v.name}
              meta={`${v.customers} ${v.customers === 1 ? "customer" : "customers"} · ${v.meta}`}
              trailing={<AmountDisplay value={v.earned} variant="positive" />}
            />
          </li>
        ))}
      </List>

      {p.recordId ? (
        <Details className="mt-6">
          <DetailRow label="Public record" value={p.recordId} mono />
          <DetailRow label="Verified by" value="Purchases settled on Arc" />
        </Details>
      ) : null}
    </Screen>
  );
}
