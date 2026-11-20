"use client";

import { useEffect, useState, type ReactNode } from "react";
import { parseUsdc } from "@vouch/shared";
import {
  AmountDisplay,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  ChoiceChips,
  DetailRow,
  Details,
  EmptyState,
  IconButton,
  Keypad,
  List,
  ListItem,
  QRFrame,
  QrCode,
  SegmentedControl,
  Sheet,
  SheetPanel,
  Skeleton,
  SkeletonRow,
  Slider,
  SplitBreakdown,
  Stat,
  SuccessMark,
  TextField,
  Toast,
  ToastViewport,
} from "@/components/ui";
import { STORY, STORY_SPLIT } from "@/design/fixtures";

function Spec({ name, children, note }: { name: string; children: ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-4 ring-1 ring-line/70 sm:p-5">
      <div>
        <h3 className="text-body font-semibold text-ink">{name}</h3>
        {note ? <p className="text-caption text-ink-3">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

const usd = parseUsdc;

export function Playground() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [seg, setSeg] = useState<"personal" | "public">("personal");
  const [rate, setRate] = useState(15);
  const [who, setWho] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  const [keyed, setKeyed] = useState("12.00");
  const [toasts, setToasts] = useState<number[]>([]);
  const [secs, setSecs] = useState(102);

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s <= 0 ? 120 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Spec name="Button" note="primary = ink (one per screen) · accent only for money moments">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Cancel order</Button>
          <Button variant="accent" leadingIcon="heart">
            Recommend
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button loading loadingLabel="Paying…">
            Pay $12.00
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary" leadingIcon="plus">
            Small
          </Button>
          <IconButton icon="close" label="Close" variant="secondary" />
        </div>
        <Button block size="lg" leadingIcon="key">
          Pay $12.00
        </Button>
      </Spec>

      <Spec name="AmountDisplay" note="bigint base units → dollars · tabular · cents by default">
        <AmountDisplay value={usd("38.45")} size="display" />
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <AmountDisplay value={STORY.total} size="xl" />
          <AmountDisplay value={STORY.total} size="lg" />
          <AmountDisplay value={STORY.total} />
          <AmountDisplay value={STORY.total} size="sm" />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <AmountDisplay value={STORY.parts.cashback} variant="positive" />
          <AmountDisplay value={-STORY.total} variant="signed" />
          <AmountDisplay value={STORY.parts.ana} variant="signed" />
          <AmountDisplay value={STORY.parts.ana} precision="exact" variant="muted" />
          <AmountDisplay value={usd("1234.5")} />
        </div>
      </Spec>

      <Spec name="Avatar · Badge" note="people are circles, venues are rounded squares, you get the green ring">
        <div className="flex items-center gap-3">
          <Avatar name="Ana" size="lg" />
          <Avatar name="Priya" />
          <Avatar name="Ben" kind="you" />
          <Avatar name="Lena's café" kind="venue" size="lg" />
          <AvatarStack names={["Ana", "Priya", "Marco", "Sofia"]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Counter</Badge>
          <Badge tone="accent" dot>
            Live
          </Badge>
          <Badge tone="warning">Expires soon</Badge>
          <Badge tone="danger">Declined</Badge>
          <Badge tone="solid">New</Badge>
        </div>
      </Spec>

      <Spec name="Card · ListItem" note="rows ≥ 56px; amounts trail; whole row is the tap target when interactive">
        <Card padding="sm">
          <List label="Example list">
            <li>
              <ListItem leading={<Avatar name="Lena's café" kind="venue" />} title="Lena's café" meta="Today, 9:41 · first visit" trailing={<AmountDisplay value={-STORY.total} variant="signed" />} trailingMeta="+$0.45 back" />
            </li>
            <li>
              <ListItem leading={<Avatar name="Ana" />} title="Ana recommended Ben" meta="Recommender" trailing={<AmountDisplay value={STORY.parts.ana} variant="positive" />} onClick={() => {}} chevron />
            </li>
          </List>
        </Card>
        <div className="grid grid-cols-3 gap-2">
          <Card tone="raised" padding="sm" className="text-caption text-ink-2">raised</Card>
          <Card tone="sunken" padding="sm" className="text-caption text-ink-2">sunken</Card>
          <Card tone="accent" padding="sm" className="text-caption text-ink-2">accent</Card>
        </div>
      </Spec>

      <Spec name="Sheet" note="modal: focus trap, Esc, backdrop, drag handle, focus restore">
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <div className="overflow-hidden rounded-lg bg-scrim pt-10">
          <SheetPanel title="Confirm payment" description="Static panel for mocks" onClose={() => {}} footer={<Button block>Pay $12.00</Button>}>
            <p className="text-body-sm text-ink-2">Sheet content.</p>
          </SheetPanel>
        </div>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Who sent you here?" description="Optional. It helps thank the right person." footer={<Button block onClick={() => setSheetOpen(false)}>Done</Button>}>
          <ChoiceChips label="Who sent you here?" value={who} onChange={setWho} options={[{ value: "Ana", label: "Ana", person: true }, { value: "Priya", label: "Priya", person: true }, { value: "other", label: "Someone else" }]} />
        </Sheet>
      </Spec>

      <Spec name="Toast" note="top of screen, polite live region, caller owns timing">
        <ToastViewport inline>
          <Toast tone="success" title="Ana's recommendation paid off" description="+$0.69 just arrived" />
          <Toast title="Code refreshed" onDismiss={() => {}} />
          <Toast tone="warning" title="Code expires in 0:15" />
          <Toast tone="danger" title="Payment didn't go through" description="Nothing was charged. Try again." action={<Button size="sm" variant="secondary">Retry</Button>} />
          {toasts.map((t) => (
            <Toast key={t} tone="success" title="New first visit" description="Ben paid $12.00" onDismiss={() => setToasts((x) => x.filter((y) => y !== t))} />
          ))}
        </ToastViewport>
        <Button size="sm" variant="secondary" onClick={() => setToasts((x) => [...x, Date.now()])}>
          Push a toast
        </Button>
      </Spec>

      <Spec name="QRFrame" note="ring drains from 12 o'clock; amber in the last 20%; expired + paid states">
        <div className="flex justify-center">
          <QRFrame secondsLeft={secs} totalSeconds={120} size={220}>
            <QrCode value="vouch:order?demo=1" />
          </QRFrame>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <QRFrame secondsLeft={18} totalSeconds={120} size={200}>
            <QrCode value="vouch:order?demo=2" />
          </QRFrame>
          <QRFrame secondsLeft={0} totalSeconds={120} state="expired" size={200} onRefresh={() => {}}>
            <QrCode value="vouch:order?demo=3" />
          </QRFrame>
          <QRFrame secondsLeft={0} totalSeconds={120} state="paid" size={200}>
            <QrCode value="vouch:order?demo=4" />
          </QRFrame>
        </div>
      </Spec>

      <Spec name="SegmentedControl · ChoiceChips" note="radio groups; arrow keys move selection">
        <SegmentedControl label="Link type" value={seg} onChange={setSeg} options={[{ value: "personal", label: "Personal" }, { value: "public", label: "Public link" }]} />
        <ChoiceChips label="Who sent you here?" value={who} onChange={setWho} options={[{ value: "Ana", label: "Ana", person: true }, { value: "Priya", label: "Priya", person: true }, { value: "other", label: "Someone else" }]} />
      </Spec>

      <Spec name="Slider · TextField" note="native range input; value as aria-valuetext">
        <Slider label="Reward rate" value={rate} min={5} max={30} onChange={setRate} formatValue={(v) => `${v}%`} minLabel="5%" maxLabel="30%" />
        <TextField label="Minimum first order" prefix="$" defaultValue="5.00" inputMode="decimal" hint="Rewards only apply above this." />
        <TextField label="Venue name" defaultValue="Lena's caf" error="That name is taken nearby" />
      </Spec>

      <Spec name="Keypad" note="64px keys for the counter">
        <p className="money text-center text-title-1 text-ink">${keyed || "0"}</p>
        <Keypad onKey={(k) => setKeyed((e) => (k === "back" ? e.slice(0, -1) : e + k))} />
      </Spec>

      <Spec name="SuccessMark (motion)" note="pop + ripple + drawn check, 0.9s; static under reduced motion">
        <div className="flex h-36 items-center justify-center">
          <SuccessMark key={replay} />
        </div>
        <Button size="sm" variant="secondary" leadingIcon="refresh" onClick={() => setReplay((r) => r + 1)}>
          Replay
        </Button>
      </Spec>

      <Spec name="Skeleton · EmptyState · Details" note="loading, nothing yet, and the only home for technical facts">
        <div aria-busy="true">
          <span className="sr-only">Loading</span>
          <SkeletonRow />
          <Skeleton className="mt-2 h-24 w-full" />
        </div>
        <EmptyState icon="users" title="No recommendations yet" body="Share Lena's café with a friend. You'll see it here when they visit." action={<Button size="sm" variant="secondary">Recommend</Button>} />
        <Details>
          <DetailRow label="Network fee" value="$0.01, paid by Kudos" />
          <DetailRow label="Receipt ID" value="0x2de25bf8…8214" mono />
        </Details>
      </Spec>

      <Spec name="Stat" note="dashboard KPIs, tabular">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Cost per new customer" value={<AmountDisplay value={usd("1.80")} size="xl" />} caption="paid only when they buy" />
          <Stat label="Verified new customers" value={23} caption="via recommendations" />
        </div>
      </Spec>

      <div className="md:col-span-2 xl:col-span-3">
        <Spec name="SplitBreakdown (signature)" note="receipt · bar · lines. The reward slice is magnified by the loupe.">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SplitBreakdown total={STORY.total} parts={STORY_SPLIT} highlightId="you" />
            <div className="flex flex-col gap-6">
              <SplitBreakdown variant="bar" total={STORY.total} parts={STORY_SPLIT} />
              <SplitBreakdown variant="lines" total={STORY.total} parts={STORY_SPLIT} precision="exact" />
            </div>
            <SplitBreakdown total={STORY.total} parts={STORY_SPLIT} precision="exact" title="Exact (transparency page)" animate={false} />
          </div>
        </Spec>
      </div>
    </div>
  );
}

/** Replays the motion tokens (fade, rise, sheet, pop) on demand. */
export function MotionDemo() {
  const [n, setN] = useState(0);
  const items: Array<[string, string]> = [
    ["animate-vx-fade-in", "fade · 240ms ease-out"],
    ["animate-vx-rise-in", "rise · 240ms ease-out"],
    ["animate-vx-sheet-in", "sheet · 360ms ease-out"],
    ["animate-vx-pop", "pop · 640ms spring"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div key={n} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([cls, label]) => (
          <div key={cls} className="flex h-28 flex-col items-center justify-end overflow-hidden rounded-md bg-surface-2 p-2">
            <span className={`mb-auto mt-4 block size-10 rounded-sm bg-accent ${cls}`} />
            <span className="text-caption text-ink-3">{label}</span>
          </div>
        ))}
      </div>
      <Button size="sm" variant="secondary" leadingIcon="refresh" onClick={() => setN((x) => x + 1)} className="self-start">
        Replay motion
      </Button>
    </div>
  );
}
