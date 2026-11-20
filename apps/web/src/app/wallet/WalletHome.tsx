"use client";

/** /wallet — balance in dollars, recent activity, top-up (testnet demo), scan, recommend; live via user SSE. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletHomeScreen, type ActivityItem } from "@/screens/customer/WalletHomeScreen";
import { api, money, type ActivityItemJson, type MyLink, type SettledLine } from "@/lib/api";
import { resolveNames, nameOr } from "@/lib/names";
import { activityItems, venueName } from "@/lib/views";
import { demoTopup } from "@/lib/topup";
import { formatMoney } from "@/design/money";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useToasts } from "@/hooks/useToasts";
import { buttonClasses } from "@/components/ui";
import type { AccountCtx } from "../_components/AccountGate";

const WEEK = 7 * 86400;

export function WalletHome({ address, name }: AccountCtx) {
  const router = useRouter();
  const toasts = useToasts();
  const [balance, setBalance] = useState<bigint>(0n);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [earnedThisWeek, setEarned] = useState<bigint>(0n);
  const [canRecommend, setCanRecommend] = useState<{ venue: string; venueName: string } | null>(null);
  const [toppingUp, setToppingUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [record, setRecord] = useState<{ verifiedCustomers: number; venueCount: number } | undefined>();
  const warnedLinks = useRef(false);

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([api.wallet(), api.activity()]);
    setBalance(money(w.balance));
    const items: ActivityItemJson[] = a.items;
    const addrs: string[] = [];
    const venues = new Set<string>();
    for (const it of items) {
      if (it.kind === "payment" && it.status === "pending") venues.add(it.venue);
      if (it.kind === "payment" && it.status === "settled") {
        venues.add(it.payment.venue);
        addrs.push(...it.payment.lines.map((l) => l.recipient));
      }
      if (it.kind === "reward") {
        venues.add(it.reward.venue);
        addrs.push(it.reward.customer, it.reward.viaReferrer);
      }
    }
    const [names, vnames] = await Promise.all([resolveNames(addrs), Promise.all([...venues].map(async (v) => [v.toLowerCase(), await venueName(v)] as const))]);
    const vmap = Object.fromEntries(vnames);
    setActivity(activityItems(items, address, names, vmap));
    const now = Date.now() / 1000;
    let earned = 0n;
    for (const it of items) {
      if (it.kind === "reward" && it.blockTime && now - it.blockTime < WEEK && !it.reward.returned) earned += money(it.reward.amount);
      if (it.kind === "payment" && it.status === "settled" && it.blockTime && now - it.blockTime < WEEK)
        earned += it.payment.lines.filter((l) => l.role === "cashback" && !l.returned && l.recipient.toLowerCase() === address.toLowerCase()).reduce((x, l) => x + money(l.amount), 0n);
    }
    setEarned(earned);
    const firstPaid = items.find((it) => it.kind === "payment" && it.status === "settled" && it.payment.customer.toLowerCase() === address.toLowerCase());
    if (firstPaid && firstPaid.kind === "payment" && firstPaid.status === "settled") setCanRecommend({ venue: firstPaid.payment.venue, venueName: vmap[firstPaid.payment.venue.toLowerCase()] ?? "this place" });
  }, [address]);

  useEffect(() => {
    (async () => {
      try {
        await load();
        setOffline(false);
      } catch {
        setOffline(true);
      } finally {
        setLoading(false);
      }
    })();
    api
      .ambassador(address)
      .then((a) => a.customersCredited > 0 && setRecord({ verifiedCustomers: a.customersCredited, venueCount: a.venues.length }))
      .catch(() => {});
  }, [load, address]);

  // Referrers: links that need a fresh share (MSG-041 #2, D-516).
  useEffect(() => {
    if (warnedLinks.current) return;
    warnedLinks.current = true;
    api
      .myLinks()
      .then(async ({ links }) => {
        const stale = links.filter((l: MyLink) => l.status === "needs_reissue");
        if (!stale.length) return;
        const v = stale[0]!.venue;
        const vn = await venueName(v);
        toasts.push({
          tone: "warning",
          key: "reissue",
          title: `Your link for ${vn} is out of date`,
          description: "The place changed its reward. Share a fresh link so friends still count.",
          action: (
            <button className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => router.push(`/recommend?venue=${v}`)}>
              Share again
            </button>
          ),
          ms: 0,
        });
      })
      .catch(() => {});
  }, [router, toasts]);

  useLiveEvents({ kind: "user", id: address }, (ev, data) => {
    if (ev === "reward.paid") {
      const l = data as unknown as SettledLine;
      if (l.customer?.toLowerCase() !== address.toLowerCase() && money(l.amount) > 0n) {
        resolveNames([l.customer, l.viaReferrer]).then((n) =>
          toasts.push({
            tone: "success",
            title: l.role === "introducer" ? `${nameOr(n, l.viaReferrer)} brought ${nameOr(n, l.customer)} in` : `Your recommendation paid off`,
            description: `${formatMoney(money(l.amount), { showPlus: true })} just arrived`,
          }),
        );
      }
    }
    if (ev === "payment.settled" || ev === "payment.pending" || ev === "reward.paid" || ev === "intro.accepted" || ev === "wallet.topup") void load().catch(() => {});
  });

  async function topUp() {
    setToppingUp(true);
    try {
      await demoTopup();
      await load();
      toasts.push({ tone: "success", title: "Money added", description: "Demo money, for trying Kudos." });
    } catch (e) {
      toasts.push({ tone: "neutral", title: e instanceof Error ? e.message : "Top-up didn't work. Try again.", ms: 7000 });
    } finally {
      setToppingUp(false);
    }
  }

  return (
    <WalletHomeScreen
      name={name}
      balance={balance}
      earnedThisWeek={earnedThisWeek > 0n ? earnedThisWeek : undefined}
      activity={activity}
      canRecommend={canRecommend ? { venueName: canRecommend.venueName } : undefined}
      onScan={() => router.push("/scan")}
      loading={loading}
      offline={offline}
      record={record}
      toppingUp={toppingUp}
      onTopUp={topUp}
      onOpenRecord={() => router.push("/me")}
      onRecommend={canRecommend ? () => router.push(`/recommend?venue=${canRecommend.venue}`) : undefined}
    />
  );
}
