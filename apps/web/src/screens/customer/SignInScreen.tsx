import { APP_NAME } from "@vouch/shared";
import { Avatar, Button, Screen } from "@/components/ui";

export interface SignInScreenProps {
  /** Present when the person arrived through a friend's recommendation link. */
  invite?: { referrerName: string; venueName: string };
  creating?: boolean;
  onCreate?: () => void;
  onSignIn?: () => void;
}

/** Onboarding / sign-in. Passkey = "Face ID or fingerprint". No passwords, no recovery phrases. */
export function SignInScreen({ invite, creating, onCreate, onSignIn }: SignInScreenProps) {
  return (
    <Screen
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" leadingIcon="key" loading={creating} loadingLabel="Setting up…" onClick={onCreate}>
            Get started
          </Button>
          <Button block variant="ghost" onClick={onSignIn}>
            I already have an account
          </Button>
          <p className="pt-1 text-center text-caption text-ink-3">Face ID or fingerprint. No passwords, nothing to write down.</p>
        </div>
      }
    >
      <div className="flex min-h-full flex-col pt-10">
        <p className="text-title-3 font-semibold tracking-tight text-ink">{APP_NAME}</p>

        {/* Signature motif in miniature: a receipt that splits */}
        <div aria-hidden className="mt-10 mb-8 rotate-[-2deg] self-start">
          <div className="perforated-bottom w-56 rounded-sm bg-surface px-4 pt-4 pb-6 shadow-2">
            <div className="flex items-baseline justify-between text-caption text-ink-3">
              <span>Lena&apos;s café</span>
              <span className="money font-semibold text-ink">$12.00</span>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full">
              <span className="w-[85%] bg-line-strong" />
              <span className="flex-1 bg-accent" />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="flex -space-x-1.5">
                <Avatar name="Ana" size="xs" className="ring-2 ring-surface" />
                <Avatar name="Priya" size="xs" className="ring-2 ring-surface" />
              </span>
              <span className="money text-caption font-semibold text-accent-ink">+$0.45 back</span>
            </div>
          </div>
        </div>

        {invite ? (
          <p className="mb-2 inline-flex items-center gap-2 self-start rounded-full bg-accent-soft py-1 pr-3 pl-1 text-caption font-medium text-accent-ink">
            <Avatar name={invite.referrerName} size="xs" />
            {invite.referrerName} sent you to {invite.venueName}
          </p>
        ) : null}
        <h1 className="text-title-1 text-ink">Pay local. Thank the friends who sent you.</h1>
        <p className="mt-3 text-body text-ink-2">
          Scan to pay at cafés, barbers and salons. Your first visit gives you money back, and pays the people whose
          recommendation brought you in.
        </p>
      </div>
    </Screen>
  );
}
