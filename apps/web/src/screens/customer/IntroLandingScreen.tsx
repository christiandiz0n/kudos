import { AmountDisplay, AppBar, Avatar, Button, Card, Screen } from "@/components/ui";

export interface IntroLandingScreenProps {
  referrerName: string;
  venueName: string;
  venueMeta: string;
  note?: string;
  /** Example cashback on an example order, e.g. $0.45 on $12.00. */
  example: { order: bigint; cashback: bigint };
  accepting?: boolean;
  onAccept?: () => void;
  onDismiss?: () => void;
}

/** A friend's recommendation link, opened while signed in. Accepting binds the recommendation to you. */
export function IntroLandingScreen({ referrerName, venueName, venueMeta, note, example, accepting, onAccept, onDismiss }: IntroLandingScreenProps) {
  return (
    <Screen
      header={<AppBar />}
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" loading={accepting} loadingLabel="Saving…" onClick={onAccept}>
            Save {referrerName}&apos;s recommendation
          </Button>
          <Button block variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
        </div>
      }
    >
      <div className="flex flex-col pt-4">
        <Avatar name={referrerName} size="lg" />
        <h1 className="mt-4 text-title-1 text-ink">
          {referrerName} thinks you&apos;ll love {venueName}
        </h1>
        {note ? (
          <blockquote className="mt-4 rounded-lg rounded-tl-xs bg-surface px-4 py-3 text-body text-ink shadow-1 ring-1 ring-line/70">
            “{note}”
          </blockquote>
        ) : null}
        <Card tone="sunken" className="mt-6 flex items-center gap-3">
          <Avatar name={venueName} kind="venue" />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-ink">{venueName}</p>
            <p className="text-caption text-ink-3">{venueMeta}</p>
          </div>
        </Card>
        <p className="mt-4 text-body-sm text-ink-2">
          On your first visit you get money back (
          <AmountDisplay value={example.cashback} size="sm" variant="positive" /> on a{" "}
          <AmountDisplay value={example.order} size="sm" /> order), and {referrerName} is thanked from the same payment. It
          costs you nothing extra.
        </p>
      </div>
    </Screen>
  );
}
