"use client";

/**
 * Account gate for every signed-in route. Onboards in place (so a scanned /pay link or a friend's /i/<code> link keeps
 * its context), unlocks an existing device account with Face ID / fingerprint, then renders the route.
 */
import { useState, type ReactNode } from "react";
import { AppFrame, Avatar, Button, Screen } from "@/components/ui";
import { SignInScreen } from "@/screens/customer/SignInScreen";
import { createAccount, signIn } from "@/lib/auth";
import { friendlyError } from "@/lib/api";
import { WalletError } from "@/lib/wallet";
import { useToasts } from "@/hooks/useToasts";
import { useSession } from "@/state/session";
import { useDeviceWallet } from "@/state/wallet";
import { RouteLoading } from "./RouteLoading";

export interface AccountCtx {
  address: `0x${string}`;
  name: string;
}

export function Onboarding({ invite, onDone }: { invite?: { referrerName: string; venueName: string }; onDone?: () => void }) {
  const wallet = useDeviceWallet();
  const toasts = useToasts();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function errorOf(e: unknown): string {
    if (e instanceof WalletError && e.code === "CANCELLED") return "cancelled";
    if (e instanceof WalletError && e.code === "NOT_SUPPORTED") return "unsupported";
    return friendlyError(e);
  }

  async function create() {
    if (!name.trim()) {
      setNameError("Add your first name so friends recognise you");
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      await createAccount(name.trim());
      onDone?.();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setCreating(false);
    }
  }

  async function existing() {
    if (!wallet) {
      toasts.push({
        tone: "neutral",
        title: "No account on this device yet",
        description: "Your account lives on the phone or browser where you created it. Open Kudos there, or start here.",
        ms: 8000,
      });
      return;
    }
    setError(undefined);
    try {
      await signIn({ wallet });
      onDone?.();
    } catch (e) {
      setError(errorOf(e));
    }
  }

  return (
    <SignInScreen
      invite={invite}
      name={name}
      onNameChange={(v) => {
        setName(v);
        setNameError(undefined);
      }}
      nameError={nameError}
      creating={creating}
      error={error}
      onCreate={create}
      onSignIn={existing}
    />
  );
}

function Unlock({ name, onDone }: { name: string; onDone?: () => void }) {
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await signIn();
      onDone?.();
    } catch (e) {
      toasts.push({ tone: "warning", title: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      footer={
        <Button block size="lg" leadingIcon="faceId" loading={busy} loadingLabel="Opening…" onClick={go}>
          Continue with Face ID or fingerprint
        </Button>
      }
    >
      <div className="flex flex-col items-start pt-16">
        <Avatar name={name || "You"} size="lg" />
        <h1 className="mt-5 text-title-1 text-ink">Welcome back{name ? `, ${name}` : ""}</h1>
        <p className="mt-2 text-body text-ink-2">Confirm it&apos;s you to open your account.</p>
      </div>
    </Screen>
  );
}

export function AccountGate({ children, invite }: { children: (ctx: AccountCtx) => ReactNode; invite?: { referrerName: string; venueName: string } }) {
  const wallet = useDeviceWallet();
  const session = useSession();
  if (wallet === undefined) return <RouteLoading />;
  if (!wallet)
    return (
      <AppFrame>
        <Onboarding invite={invite} />
      </AppFrame>
    );
  if (!session || session.address.toLowerCase() !== wallet.address.toLowerCase())
    return (
      <AppFrame>
        <Unlock name={wallet.displayName} />
      </AppFrame>
    );
  return <>{children({ address: wallet.address, name: session.user?.displayName || wallet.displayName })}</>;
}
