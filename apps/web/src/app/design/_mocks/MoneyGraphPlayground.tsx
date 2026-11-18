"use client";

import { useState } from "react";
import { Button, Card, MoneyGraph, SegmentedControl } from "@/components/ui";
import { formatMoney } from "@/design/money";
import { CANONICAL_PAYMENT_ID, NET_20, NET_5, NET_60, type SeedVenue } from "./venueFixtures";

type Size = "5" | "20" | "60";
const NETS: Record<Size, SeedVenue> = { "5": NET_5, "20": NET_20, "60": NET_60 };

/** /design/money-graph: MoneyGraph v1 at 5 / 20 / 60 people, both orientations, replayable arrival. */
export function MoneyGraphPlayground({ initialSize = "5" }: { initialSize?: Size }) {
  const [size, setSize] = useState<Size>(initialSize);
  const [mode, setMode] = useState<"payment" | "network">(initialSize === "5" ? "payment" : "network");
  const [live, setLive] = useState<"on" | "off">("on");
  const [replay, setReplay] = useState(0);
  const net = NETS[size];
  const recent = net.payments.filter((p) => p.thanked.length).slice(-4).reverse();
  const [hl, setHl] = useState<string>(CANONICAL_PAYMENT_ID);
  const hlId = recent.some((p) => p.id === hl) ? hl : CANONICAL_PAYMENT_ID;

  const graphProps = { data: net.data, mode, highlightPaymentId: hlId, live: live === "on", replayKey: replay };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl
          label="Network size"
          value={size}
          onChange={(v) => {
            setSize(v);
            setMode(v === "5" ? "payment" : "network");
          }}
          options={[
            { value: "5", label: "5 people" },
            { value: "20", label: "20 people" },
            { value: "60", label: "60 people" },
          ]}
        />
        <SegmentedControl
          label="View"
          value={mode}
          onChange={setMode}
          options={[
            { value: "payment", label: "Latest payment" },
            { value: "network", label: "Whole network" },
          ]}
        />
        <SegmentedControl
          label="Arrival animation"
          value={live}
          onChange={setLive}
          options={[
            { value: "on", label: "Live" },
            { value: "off", label: "Static" },
          ]}
        />
        <Button variant="secondary" leadingIcon="refresh" onClick={() => setReplay((r) => r + 1)}>
          Replay arrival
        </Button>
      </div>
      {recent.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-ink-2">
          <span>Highlight:</span>
          {recent.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setHl(p.id)}
              aria-pressed={p.id === hlId}
              className="focus-ring h-10 rounded-full px-3 font-medium ring-1 ring-line hover:bg-surface-2 aria-pressed:bg-ink aria-pressed:text-on-ink aria-pressed:ring-ink"
            >
              {p.customer} · {formatMoney(p.amount)}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-body-sm text-ink-3">
        {net.people} people · {net.payments.length} payments · {net.stats.verifiedCustomers} verified new customers · rewards paid{" "}
        {formatMoney(net.stats.rewardsPaid)}
      </p>

      <Card padding="md" data-shot="mg-landscape" className="w-full max-w-[1280px]">
        <p className="px-1 pb-2 text-caption text-ink-3">Landscape · projector (1280×720 viewBox)</p>
        <MoneyGraph {...graphProps} orientation="landscape" className="h-auto w-full" />
      </Card>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[380px_1fr]">
        <Card padding="sm" data-shot="mg-portrait" className="w-full max-w-[380px]">
          <p className="px-1 pb-1 text-caption text-ink-3">Portrait · phone card (360 viewBox)</p>
          <MoneyGraph {...graphProps} orientation="portrait" className="h-auto w-full" />
        </Card>
        <div className="max-w-[60ch] space-y-3 text-body-sm text-ink-2">
          <h3 className="text-title-3 text-ink">How it behaves</h3>
          <p>
            <strong className="text-ink">Layout.</strong> Money runs one way: the venue on one side, then customers, the people who
            recommended them, and whoever brought those in. Fixed positions, no physics, same input → same picture.
          </p>
          <p>
            <strong className="text-ink">Cashback</strong> is a green &ldquo;+$0.45 back&rdquo; badge on the customer, not a loop.
          </p>
          <p>
            <strong className="text-ink">Scale.</strong> At most 7 people per column on a projector (4 per row on a phone). The rest
            fold into one &ldquo;N more&rdquo; node per column; people in the highlighted payment are always shown.
          </p>
          <p>
            <strong className="text-ink">Arrival.</strong> The customer pops in, the venue stream draws, the cashback badge lands,
            then recommenders and introducers in order (140ms stagger), each pinging as money arrives; dashes run toward them for
            ~3s and settle. Reduced motion shows the final frame.
          </p>
        </div>
      </div>
    </div>
  );
}
