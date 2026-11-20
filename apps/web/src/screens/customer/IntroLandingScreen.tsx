/**
 * A friend's personal link, opened while signed in (UI_DESIGN, Phase 3). Props-only.
 * Saving = the customer confirms the recommendation with Face ID (countersign, never named as such).
 *
 * PROP CONTRACT (IntroLandingScreenProps)
 *   referrerName, venueName, venueMeta   strings (GET /intros/:code)
 *   note?                                the friend's note
 *   example                              { order, cashback } bigint: the money back on an example first order
 *   lockedSince?                         "Nov 18": the date the reward was locked in (intro terms version)
 *   state?                               "ready" (default) | "accepting" | "accepted"
 *                                        | "expired" (status expired) | "needsNewLink" (needs_reissue / LINK_NEEDS_REISSUE)
 *                                        | "alreadyCustomer" (ALREADY_REWARDED: they've bought there before)
 *                                        | "own" (their own link)
 *   error?                               "cancelled" (Face ID dismissed) | copy string; stays on "ready"
 *   onAccept, onDismiss, onDone          onDone after accepted / blocked states (e.g. go home)
 */
import { AmountDisplay, AppBar, Avatar, Button, Card, EmptyState, Icon, Screen } from "@/components/ui";

export type IntroLandingState = "ready" | "accepting" | "accepted" | "expired" | "needsNewLink" | "alreadyCustomer" | "own";

export interface IntroLandingScreenProps {
  referrerName: string;
  venueName: string;
  venueMeta: string;
  note?: string;
  /** Example cashback on an example order, e.g. $0.45 on $12.00. */
  example: { order: bigint; cashback: bigint };
  lockedSince?: string;
  state?: IntroLandingState;
  error?: "cancelled" | (string & {});
  /** @deprecated use state="accepting" */
  accepting?: boolean;
  onAccept?: () => void;
  onDismiss?: () => void;
  onDone?: () => void;
}

function Blocked({ p, icon, title, body }: { p: IntroLandingScreenProps; icon: "clock" | "receipt" | "heart"; title: string; body: string }) {
  return (
    <Screen
      header={<AppBar />}
      footer={
        <Button block size="lg" onClick={p.onDone ?? p.onDismiss}>
          Go to Vouch
        </Button>
      }
    >
      <div className="flex min-h-full flex-col justify-center">
        <EmptyState role="status" icon={icon} tone={icon === "clock" ? "warning" : "neutral"} title={title} body={body} />
      </div>
    </Screen>
  );
}

/** A friend's recommendation link, opened while signed in. Accepting binds the recommendation to you. */
export function IntroLandingScreen(p: IntroLandingScreenProps) {
  const { referrerName, venueName, venueMeta, note, example, lockedSince, error } = p;
  const state: IntroLandingState = p.state ?? (p.accepting ? "accepting" : "ready");

  if (state === "expired")
    return <Blocked p={p} icon="clock" title="This recommendation has expired" body={`Ask ${referrerName} for a fresh link to ${venueName}. It only takes them a moment.`} />;
  if (state === "needsNewLink")
    return (
      <Blocked
        p={p}
        icon="clock"
        title={`${venueName} changed its rewards`}
        body={`This link was made with the old ones. Ask ${referrerName} for a fresh link and it'll use today's.`}
      />
    );
  if (state === "alreadyCustomer")
    return (
      <Blocked
        p={p}
        icon="heart"
        title={`You've already been to ${venueName}`}
        body={`Recommendations thank a friend for your first visit, and you've had yours. Thanks for being a regular. You can recommend ${venueName} yourself.`}
      />
    );
  if (state === "own")
    return <Blocked p={p} icon="receipt" title="This is your own link" body="Send it to a friend. When they make their first purchase, part of it comes back to you." />;

  if (state === "accepted")
    return (
      <Screen
        header={<AppBar />}
        footer={
          <Button block size="lg" onClick={p.onDone}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col items-center pt-16 text-center" role="status">
          <span className="inline-flex size-20 animate-vx-pop items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <Icon name="heart" size={36} />
          </span>
          <h1 className="mt-6 text-title-1 text-ink">Saved</h1>
          <p className="mt-3 max-w-[30ch] text-body text-ink-2">
            Next time you&apos;re at {venueName}, scan to pay. You&apos;ll get{" "}
            <AmountDisplay value={example.cashback} variant="positive" size="md" /> back on a{" "}
            <AmountDisplay value={example.order} size="md" /> order, and {referrerName} is thanked from the same payment.
          </p>
        </div>
      </Screen>
    );

  const accepting = state === "accepting";
  const err = error === "cancelled" ? "Face ID or fingerprint was cancelled. Nothing was saved." : error;

  return (
    <Screen
      header={<AppBar />}
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" leadingIcon="faceId" loading={accepting} loadingLabel="Saving…" onClick={p.onAccept}>
            Save {referrerName}&apos;s recommendation
          </Button>
          <Button block variant="ghost" onClick={p.onDismiss} disabled={accepting}>
            Not now
          </Button>
        </div>
      }
    >
      <div className="flex flex-col pt-2">
        <div className="flex items-center gap-3">
          <Avatar name={referrerName} size="lg" />
          <span aria-hidden className="flex items-center gap-1 text-primary-ink">
            <span className="h-px w-3 border-b-2 border-dotted border-primary-soft-2" />
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary-soft">
              <Icon name="heart" size={16} />
            </span>
            <span className="h-px w-3 border-b-2 border-dotted border-primary-soft-2" />
          </span>
          <Avatar name={venueName} kind="venue" size="lg" />
        </div>
        <h1 className="mt-5 text-title-1 text-ink">
          {referrerName} vouched for {venueName}
        </h1>
        <p className="mt-1 text-body-sm text-ink-3">{venueMeta}</p>
        {note ? (
          <blockquote className="mt-4 rounded-lg rounded-tl-xs bg-surface px-4 py-3 text-body text-ink shadow-1 ring-1 ring-line/70">
            “{note}”
            <footer className="mt-1 text-caption text-ink-3">{referrerName}</footer>
          </blockquote>
        ) : null}

        <Card tone="accent" className="mt-5 animate-vx-rise-in" padding="lg">
          <p className="text-body-sm font-semibold text-accent-ink">On your first visit</p>
          <p className="mt-1 flex items-baseline gap-2 text-body text-ink">
            <AmountDisplay value={example.cashback} variant="positive" size="lg" splitCents={false} />
            <span>
              back on a <AmountDisplay value={example.order} size="md" /> order
            </span>
          </p>
          <p className="mt-2 text-body-sm text-ink-2">
            {referrerName} is thanked from the same payment. It costs you nothing extra.
          </p>
        </Card>

        <p className="mt-4 flex items-start gap-2 text-body-sm text-ink-2">
          <Icon name="lock" size={18} className="mt-px shrink-0 text-ink-3" />
          <span>
            <span className="font-semibold text-ink">Locked in{lockedSince ? ` on ${lockedSince}` : ""}.</span> This reward stays as it is,
            even if {venueName} changes its rewards later.
          </span>
        </p>

        {err ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-body-sm text-warning-ink">
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            {err}
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
