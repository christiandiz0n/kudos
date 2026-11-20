/**
 * Onboarding / sign-in (UI_DESIGN, Phase 3). Props-only. Passkey = "Face ID or fingerprint" (D-017).
 *
 * PROP CONTRACT (SignInScreenProps)
 *   invite?          { referrerName, venueName } when they arrived through a friend's link (green chip)
 *   name, onNameChange   controlled first-name field (sent as displayName to POST /auth/verify)
 *   nameError?       e.g. "Add your first name so friends recognise you"
 *   creating?        Face ID prompt / account setup in flight
 *   error?           "cancelled" (prompt dismissed) | "unsupported" (no passkeys on this browser) | any copy string
 *   onCreate         "Continue with Face ID or fingerprint" (new account)
 *   onSignIn         "I already have an account" (passkey sign-in, no name needed)
 */
import { APP_NAME } from "@vouch/shared";
import { Avatar, Button, Icon, Screen, TextField } from "@/components/ui";

export interface SignInScreenProps {
  /** Present when the person arrived through a friend's recommendation link. */
  invite?: { referrerName: string; venueName: string };
  name?: string;
  onNameChange?: (name: string) => void;
  nameError?: string;
  creating?: boolean;
  error?: "cancelled" | "unsupported" | (string & {});
  onCreate?: () => void;
  onSignIn?: () => void;
}

const FORM_ID = "vx-sign-in";

function errorCopy(error: SignInScreenProps["error"]) {
  if (!error) return null;
  if (error === "cancelled") return "Face ID or fingerprint was cancelled. Try again when you're ready.";
  if (error === "unsupported") return "This browser can't use Face ID or fingerprint. Try Safari on iPhone or Chrome on Android.";
  return error;
}

/** What Vouch does, in one picture: you pay, money comes back to you, a friend is thanked. Decorative. */
function HeroCard() {
  return (
    <div aria-hidden className="relative overflow-hidden rounded-xl bg-primary-soft px-5 pt-4 pb-5">
      <div className="perforated-bottom mx-auto w-full max-w-64 rotate-[-1.5deg] rounded-sm bg-surface px-4 pt-4 pb-6 shadow-2 animate-vx-rise-in">
        <div className="flex items-baseline justify-between text-caption text-ink-3">
          <span className="flex items-center gap-2">
            <Avatar name="Lena's café" kind="venue" size="xs" />
            Lena&apos;s café
          </span>
          <span className="money font-semibold text-ink">$12.00</span>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full">
          <span className="w-[85%] bg-primary-soft-2" />
          <span className="flex-1 bg-accent" />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-caption text-ink-2">
            <Avatar name="Ana" size="xs" className="ring-2 ring-surface" />
            Ana thanked
          </span>
          <span className="money text-caption font-semibold text-accent-ink">+$0.45 back</span>
        </div>
      </div>
    </div>
  );
}

export function SignInScreen({ invite, name = "", onNameChange, nameError, creating, error, onCreate, onSignIn }: SignInScreenProps) {
  const err = errorCopy(error);
  return (
    <Screen
      footer={
        <form
          id={FORM_ID}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate?.();
          }}
        >
          <Button type="submit" block size="lg" leadingIcon="faceId" loading={creating} loadingLabel="Setting up…">
            Continue with Face ID or fingerprint
          </Button>
          <p className="px-2 text-center text-caption text-ink-2">
            <Icon name="lock" size={14} className="mr-1 inline-block -translate-y-px align-middle text-primary-ink" />
            No password, nothing to write down. Your face or fingerprint keeps your account safe.
          </p>
          <Button block variant="ghost" onClick={onSignIn} disabled={creating}>
            I already have an account
          </Button>
        </form>
      }
    >
      <div className="flex min-h-full flex-col pt-6">
        <p className="flex items-center gap-2 text-title-3 font-semibold tracking-tight text-primary-ink">
          <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-on-primary">
            <Icon name="check" size={16} />
          </span>
          {APP_NAME}
        </p>
        {/* After a failed attempt the picture steps aside so the message and the button stay in view. */}
        <div className={err ? "mt-6" : "mt-5 mb-6"}>{err ? null : <HeroCard />}</div>

        {invite ? (
          <p className="mb-3 inline-flex min-h-8 items-center gap-2 self-start rounded-full bg-accent-soft py-1 pr-3 pl-1 text-body-sm font-medium text-accent-ink">
            <Avatar name={invite.referrerName} size="xs" />
            {invite.referrerName} sent you to {invite.venueName}
          </p>
        ) : null}
        <h1 className="text-title-1 text-balance text-ink">Get money back when a friend sends you somewhere new.</h1>
        <p className="mt-3 text-body text-ink-2">
          Scan to pay at local cafés, barbers and salons. Your first visit gives you money back and thanks the friend who
          recommended it.
        </p>

        <TextField
          className="mt-6"
          label="Your first name"
          placeholder="Ben"
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="go"
          maxLength={40}
          form={FORM_ID}
          value={name}
          onChange={(e) => onNameChange?.(e.target.value)}
          error={nameError}
          hint="Friends see this when you recommend a place."
        />

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
