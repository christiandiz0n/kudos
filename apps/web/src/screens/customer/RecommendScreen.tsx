"use client";

/**
 * Recommend / share (UI_DESIGN, Phase 3). Props-only.
 *
 * PROP CONTRACT (RecommendScreenProps)
 *   yourName, venueName
 *   exampleEarn            { order, earn } bigint: what you'd get if a friend's first order is `order`
 *   kind, onKindChange     "personal" (linkType personal, counts double) | "public" (broadcast)
 *   note, onNoteChange     optional note (≤120 chars) → POST /intros {note}
 *   locked?                true when you're not a verified customer at this venue yet ("buy once to vouch")
 *   link?                  { url, display } once created (POST /intros → {url}); null/undefined = not created yet.
 *                          Reset it when `kind` changes (each kind is its own link).
 *   creating?              Face ID prompt + POST /intros in flight (creating = confirming the recommendation)
 *   error?                 "cancelled" | copy string
 *   copied?                show "Copied" for ~2s after onCopy (caller's timer)
 *   canShare?              navigator.share exists → primary "Share link"; otherwise primary is "Copy link"
 *   onCreate, onShare, onCopy, onBack, onScan (locked state → "Scan to pay")
 */
import { AmountDisplay, AppBar, Button, Card, EmptyState, Icon, IconButton, QrCode, Screen, SegmentedControl, TextField } from "@/components/ui";

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
  locked?: boolean;
  link?: { url: string; display: string } | null;
  creating?: boolean;
  error?: "cancelled" | (string & {});
  copied?: boolean;
  canShare?: boolean;
  onCreate?: () => void;
  onShare?: () => void;
  onCopy?: () => void;
  onBack?: () => void;
  onScan?: () => void;
}

const COPY: Record<LinkKind, { title: string; body: string }> = {
  personal: { title: "For one friend", body: "Send it to someone you know. Personal recommendations count double." },
  public: { title: "For a group or your socials", body: "Anyone can use it. Good for a group chat or a story." },
};

function Header({ p }: { p: RecommendScreenProps }) {
  return <AppBar leading={<IconButton icon="arrowLeft" label="Back" onClick={p.onBack} />} title={`Recommend ${p.venueName}`} large />;
}

/** What each side gets, in plain words. The one thing to understand before sharing. */
function GetsCard({ p }: { p: RecommendScreenProps }) {
  return (
    <section aria-label="What you both get" className="overflow-hidden rounded-lg bg-surface shadow-1 ring-1 ring-line/60">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <Icon name="users" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium text-ink-3">Your friend gets</p>
          <p className="text-body font-semibold text-ink">Money back on their first visit</p>
        </div>
      </div>
      <div className="flex items-start gap-3 border-t border-line bg-accent-soft px-4 py-3.5">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-accent-ink">
          <Icon name="heart" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium text-ink-2">You get</p>
          <p className="text-body font-semibold text-ink">
            About <AmountDisplay value={p.exampleEarn.earn} variant="positive" size="md" /> when they spend{" "}
            <AmountDisplay value={p.exampleEarn.order} size="md" />
          </p>
          <p className="text-caption text-ink-2">Paid the moment they pay.</p>
        </div>
      </div>
    </section>
  );
}

export function RecommendScreen(p: RecommendScreenProps) {
  if (p.locked) {
    return (
      <Screen
        header={<Header p={p} />}
        footer={
          <Button block size="lg" leadingIcon="scan" onClick={p.onScan}>
            Scan to pay
          </Button>
        }
      >
        <EmptyState
          role="status"
          icon="lock"
          title="Buy once to vouch"
          body={
            <>
              You can recommend {p.venueName} after your first purchase there. That way every recommendation on Kudos comes from a real
              customer, and friends can trust it.
            </>
          }
          className="pt-12"
        />
        <Card tone="sunken" className="mt-2">
          <p className="text-body-sm text-ink-2">
            After that, each friend you send who makes a first purchase earns you about{" "}
            <AmountDisplay value={p.exampleEarn.earn} variant="positive" size="sm" className="font-semibold" /> on a{" "}
            <AmountDisplay value={p.exampleEarn.order} size="sm" /> order.
          </p>
        </Card>
      </Screen>
    );
  }

  const link = p.link ?? null;
  const err = p.error === "cancelled" ? "Face ID or fingerprint was cancelled. No link was made." : p.error;

  const footer = link ? (
    <div className="flex gap-2">
      {p.canShare ? (
        <>
          <Button variant="secondary" size="lg" leadingIcon={p.copied ? "check" : "copy"} onClick={p.onCopy} aria-label={p.copied ? "Link copied" : "Copy link"}>
            {p.copied ? "Copied" : "Copy"}
          </Button>
          <Button block size="lg" leadingIcon="share" onClick={p.onShare}>
            Share link
          </Button>
        </>
      ) : (
        <Button block size="lg" leadingIcon={p.copied ? "check" : "copy"} onClick={p.onCopy}>
          {p.copied ? "Link copied" : "Copy link"}
        </Button>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <Button block size="lg" leadingIcon="faceId" loading={p.creating} loadingLabel="Making your link…" onClick={p.onCreate}>
        Make my link
      </Button>
      <p className="text-center text-caption text-ink-3">Confirm with Face ID or fingerprint</p>
    </div>
  );

  return (
    <Screen header={<Header p={p} />} footer={footer}>
      {link ? (
        <Card className="mt-2 flex animate-vx-rise-in flex-col items-center gap-4" padding="lg">
          <p className="flex items-center gap-2 text-body font-semibold text-ink">
            <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-on-primary">
              <Icon name="check" size={16} />
            </span>
            Your link is ready
          </p>
          <div className="rounded-md bg-white p-2 ring-1 ring-primary-soft-2">
            <QrCode value={link.url} size={176} label={`Code for your link to ${p.venueName}`} />
          </div>
          <div className="w-full text-center">
            <p className="text-body-sm font-semibold text-ink">
              {p.yourName} recommends {p.venueName}
            </p>
            {p.note ? <p className="mt-0.5 text-body-sm text-ink-2">“{p.note}”</p> : null}
            <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-caption font-medium text-ink-2">
              <Icon name="link" size={14} className="shrink-0" />
              <span className="truncate">{link.display}</span>
            </p>
          </div>
          <p className="w-full rounded-md bg-accent-soft px-3 py-2.5 text-center text-body-sm text-ink">
            Your friend gets money back on their first visit. You get about{" "}
            <AmountDisplay value={p.exampleEarn.earn} variant="positive" size="sm" className="font-semibold" /> when they spend{" "}
            <AmountDisplay value={p.exampleEarn.order} size="sm" />.
          </p>
          <p className="text-caption text-ink-3">Share it, or let a friend scan this from your screen.</p>
        </Card>
      ) : (
        <>
          <div className="mt-2">
            <GetsCard p={p} />
          </div>
          <div className="mt-6">
            <SegmentedControl
              label="Who is this for?"
              value={p.kind}
              onChange={p.onKindChange}
              options={[
                { value: "personal", label: "One friend" },
                { value: "public", label: "Anyone" },
              ]}
            />
            <p className="mt-2.5 text-body-sm text-ink-2">
              <span className="font-semibold text-ink">{COPY[p.kind].title}.</span> {COPY[p.kind].body}
            </p>
          </div>
          <TextField
            className="mt-5"
            label="Add a note (optional)"
            placeholder="Best cortado in the neighbourhood"
            value={p.note}
            onChange={(e) => p.onNoteChange(e.target.value)}
            maxLength={120}
          />
        </>
      )}

      {err ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-body-sm text-warning-ink">
          <Icon name="alert" size={18} className="mt-px shrink-0" />
          {err}
        </p>
      ) : null}
    </Screen>
  );
}
