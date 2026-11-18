"use client";

/**
 * /i/<code> — a friend's recommendation link. GET /intros/:code (public) → record the open (counts for attribution only
 * when signed in, D-807) → onboard in place if needed → "Save <name>'s recommendation": POST accept/prepare → sign
 * IntroAcceptance (Face ID) → POST accept (relayed) → `intro.accepted` (Streams) or relay polling.
 * Outdated links (terms changed, D-516) show "ask for a new link" (MSG-041 #2).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { parseUsdc } from "@vouch/shared";
import { EmptyState, Screen, buttonClasses } from "@/components/ui";
import { IntroLandingScreen, type IntroLandingState } from "@/screens/customer/IntroLandingScreen";
import { exampleSplit } from "@/screens/venue/VenueOnboardingScreen";
import { ApiError, api, friendlyError, waitRelay, type IntroGet } from "@/lib/api";
import { rememberName } from "@/lib/names";
import { signTypedDataJson } from "@/lib/sign";
import { getSigner, WalletError } from "@/lib/wallet";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { AccountGate, type AccountCtx } from "../../_components/AccountGate";
import { RouteLoading } from "../../_components/RouteLoading";

const EXAMPLE = parseUsdc("12.00");

function stateFor(e: unknown): IntroLandingState | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === "ALREADY_REWARDED") return "alreadyCustomer";
  if (e.code === "LINK_NEEDS_REISSUE") return "needsNewLink";
  if (e.code === "INTRO_EXPIRED" || e.code === "INTRO_ALREADY_USED") return "expired";
  if (e.code === "SELF_REFERRAL") return "own";
  return null;
}

function Landing({ intro, address }: { intro: IntroGet } & AccountCtx) {
  const router = useRouter();
  const referrerName = intro.referrer.displayName ?? "A friend";
  const venueName = intro.venue.name ?? "a local place";
  const initial: IntroLandingState =
    intro.referrer.address.toLowerCase() === address.toLowerCase() ? "own" : intro.status === "expired" ? "expired" : intro.status === "needs_reissue" ? "needsNewLink" : "ready";
  const [state, setState] = useState<IntroLandingState>(initial);
  const [error, setError] = useState<string | undefined>();
  const introHash = intro.introHash.toLowerCase();
  const opened = useRef(false);

  // Count this signed-in open (D-807: only the paying customer's own signed-in opens move attribution).
  useEffect(() => {
    if (opened.current || initial === "own") return;
    opened.current = true;
    api.introOpen(intro.code).catch(() => {});
  }, [intro.code, initial]);

  useLiveEvents({ kind: "user", id: address }, (ev, data) => {
    if (ev === "intro.accepted" && String(data.introHash).toLowerCase() === introHash) setState("accepted");
    if (ev === "intro.failed" && String(data.introHash).toLowerCase() === introHash) {
      setState("ready");
      setError(friendlyError(new ApiError(0, String(data.error ?? "TX_FAILED"), "", false)));
    }
  });

  async function accept() {
    setState("accepting");
    setError(undefined);
    try {
      const prep = await api.introAcceptPrepare(intro.code);
      const signer = await getSigner({ fresh: true });
      const signature = await signTypedDataJson(signer, prep.typedData);
      const res = await api.introAccept(intro.code, { acceptance: prep.acceptance, signature });
      // Relay mined is enough to call it saved; Streams' intro.accepted usually lands first.
      await waitRelay(res.relayId).catch((e) => {
        if (!(e instanceof ApiError && e.code === "TIMEOUT")) throw e;
      });
      setState("accepted");
    } catch (e) {
      const s = stateFor(e);
      if (s) setState(s);
      else {
        setState("ready");
        setError(e instanceof WalletError && e.code === "CANCELLED" ? "cancelled" : friendlyError(e));
      }
    }
  }

  const issued = Number(intro.issuedAt) * 1000;
  return (
    <IntroLandingScreen
      referrerName={referrerName}
      venueName={venueName}
      venueMeta="Money back on your first visit"
      example={{ order: EXAMPLE, cashback: exampleSplit(EXAMPLE, intro.terms.rewardBps).cashback }}
      lockedSince={issued ? new Date(issued).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : undefined}
      state={state}
      error={error}
      onAccept={accept}
      onDismiss={() => router.push("/wallet")}
      onDone={() => router.push("/wallet")}
    />
  );
}

export function IntroLanding() {
  const { code } = useParams<{ code: string }>();
  const [intro, setIntro] = useState<IntroGet | null | undefined>(undefined);
  useEffect(() => {
    api
      .intro(code)
      .then((i) => {
        rememberName(i.referrer.address, i.referrer.displayName);
        setIntro(i);
      })
      .catch(() => setIntro(null));
  }, [code]);
  if (intro === undefined) return <RouteLoading />;
  if (intro === null)
    return (
      <Screen>
        <EmptyState
          className="pt-24"
          icon="link"
          tone="warning"
          title="This link doesn't work"
          body="It may have been mistyped. Ask your friend to send it again."
          action={
            <Link href="/" className={buttonClasses({ variant: "secondary" })}>
              Open Vouch
            </Link>
          }
        />
      </Screen>
    );
  return (
    <AccountGate invite={{ referrerName: intro.referrer.displayName ?? "A friend", venueName: intro.venue.name ?? "a local place" }}>
      {(ctx) => <Landing intro={intro} {...ctx} />}
    </AccountGate>
  );
}
