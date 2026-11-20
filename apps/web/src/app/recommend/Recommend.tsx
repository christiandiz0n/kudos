"use client";

/**
 * /recommend?venue=<venue> — make a personal (single-use, counts double) or public (broadcast) recommendation link:
 * POST /intros/prepare → sign Intro (Face ID) → POST /intros {note} → native share / copy. Only verified customers
 * (or seed ambassadors) of the venue may refer; otherwise the screen is "locked" (buy once first).
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAddress, type Address } from "viem";
import { parseUsdc } from "@vouch/shared";
import { RecommendScreen, type LinkKind } from "@/screens/customer/RecommendScreen";
import { exampleSplit } from "@/screens/venue/VenueOnboardingScreen";
import { ApiError, api, friendlyError } from "@/lib/api";
import { webOrigin } from "@/lib/config";
import { signTypedDataJson } from "@/lib/sign";
import { getSigner, WalletError } from "@/lib/wallet";
import { venueName as fetchVenueName } from "@/lib/views";
import { AccountGate, type AccountCtx } from "../_components/AccountGate";

const EXAMPLE = parseUsdc("12.00");

function Flow({ address, name }: AccountCtx) {
  const router = useRouter();
  const params = useSearchParams();
  const param = params.get("venue");
  const [venue, setVenue] = useState<Address | null>(param && isAddress(param) ? param : null);
  const [venueName, setVenueName] = useState("");
  const [rewardBps, setRewardBps] = useState(1500);
  const [locked, setLocked] = useState(false);
  const [kind, setKind] = useState<LinkKind>("personal");
  const [note, setNote] = useState("");
  const [links, setLinks] = useState<Partial<Record<LinkKind, { url: string; display: string }>>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  // Which venue, and am I allowed to recommend it (verified customer there)?
  useEffect(() => {
    let alive = true;
    api
      .activity()
      .then((a) => {
        if (!alive) return;
        const paidAt = a.items.flatMap((it) => (it.kind === "payment" && it.status === "settled" && it.payment.customer.toLowerCase() === address.toLowerCase() ? [it.payment.venue] : []));
        const v = venue ?? (paidAt[0] as Address | undefined) ?? null;
        if (!venue && v) setVenue(v);
        // Seed ambassadors may refer without buying; the API has the final word (REFERRER_NOT_ELIGIBLE).
        if (v && !paidAt.some((x) => x.toLowerCase() === v.toLowerCase())) setLocked(true);
        if (!v) setLocked(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [address, venue]);

  useEffect(() => {
    if (!venue) return;
    fetchVenueName(venue).then(setVenueName);
    api
      .venue(venue)
      .then((v) => v.terms && setRewardBps(v.terms.rewardBps))
      .catch(() => {});
  }, [venue]);

  async function create() {
    if (!venue) return;
    setCreating(true);
    setError(undefined);
    try {
      const prep = await api.introPrepare({ venue, linkType: kind === "personal" ? "personal" : "broadcast" });
      const signer = await getSigner({ fresh: true });
      const signature = await signTypedDataJson(signer, prep.typedData);
      const res = await api.introCreate({ intro: prep.intro, signature, ...(note.trim() ? { note: note.trim() } : {}) });
      const url = `${webOrigin()}/i/${res.code}`;
      setLinks((l) => ({ ...l, [kind]: { url, display: url.replace(/^https?:\/\//, "") } }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "REFERRER_NOT_ELIGIBLE") setLocked(true);
      else setError(e instanceof WalletError && e.code === "CANCELLED" ? "cancelled" : friendlyError(e));
    } finally {
      setCreating(false);
    }
  }

  const link = links[kind] ?? null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: `${venueName} on Kudos`, text: note.trim() || `${name} recommends ${venueName}`, url: link.url });
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") await copy();
    }
  }

  return (
    <RecommendScreen
      yourName={name}
      venueName={venueName || "this place"}
      exampleEarn={{ order: EXAMPLE, earn: exampleSplit(EXAMPLE, rewardBps).l1 }}
      kind={kind}
      onKindChange={(k) => {
        setKind(k);
        setError(undefined);
      }}
      note={note}
      onNoteChange={setNote}
      locked={locked}
      link={link}
      creating={creating}
      error={error}
      copied={copied}
      canShare={typeof navigator !== "undefined" && typeof navigator.share === "function"}
      onCreate={create}
      onShare={share}
      onCopy={copy}
      onBack={() => router.push("/wallet")}
      onScan={() => router.push("/scan")}
    />
  );
}

export function Recommend() {
  return <AccountGate>{(ctx) => <Flow {...ctx} />}</AccountGate>;
}
