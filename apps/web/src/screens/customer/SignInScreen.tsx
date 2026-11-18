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

/** Signature motif in miniature: a receipt that splits. Decorative. */
function MiniReceipt() {
  return (
    <div aria-hidden className="rotate-[-2deg] self-start">
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
          <span className="flex -space-x-1">
            <Avatar name="Ana" size="xs" className="ring-2 ring-surface" />
            <Avatar name="Priya" size="xs" className="ring-2 ring-surface" />
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
          <Button block variant="ghost" onClick={onSignIn} disabled={creating}>
            I already have an account
          </Button>
        </form>
      }
    >
      <div className="flex min-h-full flex-col pt-8">
        <p className="text-title-3 font-semibold tracking-tight text-ink">{APP_NAME}</p>
        <div className="mt-8 mb-7">
          <MiniReceipt />
        </div>

        {invite ? (
          <p className="mb-3 inline-flex items-center gap-2 self-start rounded-full bg-accent-soft py-1 pr-3 pl-1 text-body-sm font-medium text-accent-ink">
            <Avatar name={invite.referrerName} size="xs" />
            {invite.referrerName} sent you to {invite.venueName}
          </p>
        ) : null}
        <h1 className="text-title-1 text-ink">Pay local. Thank the friends who sent you.</h1>
        <p className="mt-3 text-body text-ink-2">
          Scan to pay at cafés, barbers and salons. Your first visit gives you money back, and pays the people whose
          recommendation brought you in.
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

        <p className="mt-5 flex items-start gap-2 text-body-sm text-ink-2">
          <Icon name="faceId" size={18} className="mt-px shrink-0 text-ink-3" />
          Nothing to download, no password, nothing to write down. Your face or fingerprint keeps your account safe.
        </p>
      </div>
    </Screen>
  );
}
