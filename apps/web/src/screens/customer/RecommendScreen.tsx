"use client";

import { AmountDisplay, AppBar, Avatar, Button, Card, IconButton, Screen, SegmentedControl, TextField } from "@/components/ui";

export type LinkKind = "personal" | "public";

export interface RecommendScreenProps {
  yourName: string;
  venueName: string;
  /** e.g. 15% of a $12.00 first purchase × 55% (direct recommenders' share) if you're the only one. */
  exampleEarn: { order: bigint; earn: bigint };
  kind: LinkKind;
  onKindChange: (kind: LinkKind) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** Display-only short link, e.g. "vouch.app/r/lena-ana". */
  linkPreview: string;
  onShare?: () => void;
  onCopy?: () => void;
  onBack?: () => void;
}

const COPY: Record<LinkKind, { title: string; body: string }> = {
  personal: { title: "For one friend", body: "Send it to someone you know. Personal recommendations count double." },
  public: { title: "For a group or your socials", body: "Anyone can use it. Good for a group chat or a story." },
};

export function RecommendScreen(p: RecommendScreenProps) {
  return (
    <Screen
      header={<AppBar leading={<IconButton icon="arrowLeft" label="Back" onClick={p.onBack} />} title={`Recommend ${p.venueName}`} large />}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" leadingIcon="copy" onClick={p.onCopy} aria-label="Copy link">
            Copy
          </Button>
          <Button block size="lg" leadingIcon="share" onClick={p.onShare}>
            Share link
          </Button>
        </div>
      }
    >
      <SegmentedControl
        label="Who is this for?"
        value={p.kind}
        onChange={p.onKindChange}
        options={[
          { value: "personal", label: "Personal" },
          { value: "public", label: "Public link" },
        ]}
      />
      <p className="mt-3 text-body-sm text-ink-2">
        <span className="font-semibold text-ink">{COPY[p.kind].title}.</span> {COPY[p.kind].body}
      </p>

      <TextField
        className="mt-6"
        label="Add a note (optional)"
        placeholder="Best cortado in the neighbourhood"
        value={p.note}
        onChange={(e) => p.onNoteChange(e.target.value)}
        maxLength={120}
      />

      {/* What your friend will see */}
      <p className="mt-6 mb-2 text-body-sm font-semibold text-ink-2">Your friend sees</p>
      <Card className="flex gap-3">
        <Avatar name={p.yourName} />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-ink">
            {p.yourName} recommends {p.venueName}
          </p>
          {p.note ? <p className="mt-0.5 text-body-sm text-ink-2">“{p.note}”</p> : null}
          <p className="mt-1 truncate text-caption text-ink-3">{p.linkPreview}</p>
        </div>
      </Card>

      <Card tone="accent" className="mt-4">
        <p className="text-body-sm text-ink">
          When a friend makes their first purchase, you get part of it: about{" "}
          <AmountDisplay value={p.exampleEarn.earn} variant="positive" size="sm" className="font-semibold" /> on a{" "}
          <AmountDisplay value={p.exampleEarn.order} size="sm" /> order. Paid the moment they pay.
        </p>
      </Card>
    </Screen>
  );
}
