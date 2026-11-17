/**
 * Read endpoints. Wallet balance is read from chain; activity, ambassador record and venue stats come from
 * STREAMS_INFRA's derived tables (StreamsPort). Local relay state only ever adds "pending" items.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getAddress, zeroAddress, type Address } from 'viem';
import { formatNativeAsUsdc } from '@vouch/shared';
import { introLinks, paymentIntents, relayTxs, users, venuesMeta } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, money, sameAddr } from '../http/json';
import { send, type Ctx } from './common';
import { lineView, settledView } from './views';

export function registerReadRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps } = ctx;
  const db = deps.handle.db;
  const s = deps.streams;

  app.get('/me/wallet', async (req, reply) => {
    const c = await ctx.auth(req);
    const [balance, pending] = await Promise.all([
      deps.chain.usdcBalance(c.sub),
      db.select().from(paymentIntents).where(and(eq(paymentIntents.customer, c.sub), eq(paymentIntents.status, 'relaying'))),
    ]);
    const rewards = await s.listRewardLines({ recipient: c.sub, limit: 200 });
    const earned = rewards.filter((l) => !l.returned).reduce((a, l) => a + l.amount, 0n);
    return send(reply, 200, {
      address: c.sub,
      balance: money(balance),
      rewardsEarned: money(earned),
      pending: pending.map((p) => ({ intentId: p.id, venue: p.venue, orderId: p.orderId, amount: money(p.amount), txHash: p.txHash, status: 'pending' })),
    });
  });

  app.get('/me/activity', async (req, reply) => {
    const c = await ctx.auth(req);
    const [payments, rewards, introsIn, introsOut, cursor, pending] = await Promise.all([
      s.listPayments({ customer: c.sub, limit: 50 }),
      s.listRewardLines({ recipient: c.sub, limit: 100 }),
      s.listIntrosAccepted({ customer: c.sub, limit: 50 }),
      s.listIntrosAccepted({ referrer: c.sub, limit: 50 }),
      s.cursor(),
      db.select().from(paymentIntents).where(and(eq(paymentIntents.customer, c.sub), inArray(paymentIntents.status, ['relaying', 'relayed']))),
    ]);
    const settledKeys = new Set(payments.map((p) => `${p.venue.toLowerCase()}:${p.orderId.toLowerCase()}`));
    const items = [
      ...payments.map((p) => ({ kind: 'payment', status: 'settled', blockNumber: p.blockNumber, blockTime: p.blockTime, payment: settledView(p) })),
      // Rewards from someone else's purchase (my own cashback is inside my payment).
      ...rewards.filter((l) => !sameAddr(l.customer, c.sub)).map((l) => ({ kind: 'reward', status: 'settled', blockNumber: l.blockNumber, blockTime: l.blockTime, reward: lineView(l) })),
      ...introsIn.map((i) => ({ kind: 'intro_received', status: 'settled', blockNumber: i.blockNumber, blockTime: i.blockTime, intro: i })),
      ...introsOut.map((i) => ({ kind: 'intro_sent', status: 'settled', blockNumber: i.blockNumber, blockTime: i.blockTime, intro: i })),
    ].sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0));
    const pendingItems = pending
      .filter((p) => !settledKeys.has(`${p.venue.toLowerCase()}:${p.orderId.toLowerCase()}`))
      .map((p) => ({ kind: 'payment', status: 'pending', intentId: p.id, venue: p.venue, orderId: p.orderId, amount: money(p.amount), txHash: p.txHash }));
    return send(reply, 200, { address: c.sub, items: [...pendingItems, ...items], cursor });
  });

  app.get('/ambassadors/:address', async (req, reply) => {
    const a = addr((req.params as { address: string }).address, 'address');
    const [rec, u, links] = await Promise.all([
      s.getAmbassador(a),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.address, a)).limit(1),
      db.select({ code: introLinks.code }).from(introLinks).where(eq(introLinks.referrer, a)),
    ]);
    const venueNames = rec.venues.length
      ? await db.select({ venue: venuesMeta.venue, name: venuesMeta.name }).from(venuesMeta).where(inArray(venuesMeta.venue, rec.venues.map((v) => getAddress(v))))
      : [];
    return send(reply, 200, {
      address: a,
      displayName: u[0]?.displayName ?? null,
      customersCredited: rec.customersCredited,
      venues: rec.venues.map((v) => ({ venue: v, name: venueNames.find((n) => sameAddr(n.venue, v))?.name ?? null })),
      earned: { referrer: money(rec.l1Earned), introducer: money(rec.l2Earned), cashback: money(rec.cashbackEarned), total: money(rec.l1Earned + rec.l2Earned) },
      linksShared: links.length,
      recent: rec.lines.map(lineView),
      source: 'streams',
    });
  });

  app.get('/venues/:venue/stats', async (req, reply) => {
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    // QE-2-08: unknown venue → 404 (same as GET /venues/:venue).
    if (!(await s.getVenue(venue)) && (await deps.chain.getVenue(venue)).owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');
    const st = (await s.getVenueStats(venue)) as Awaited<ReturnType<typeof s.getVenueStats>> & {
      venueReceived?: bigint;
      cashbackPaid?: bigint;
      l1Paid?: bigint;
      l2Paid?: bigint;
      rewardedCustomers?: number;
    };
    const cpvc = st.verifiedCustomers > 0 ? st.rewardsPaid / BigInt(st.verifiedCustomers) : null;
    return send(reply, 200, {
      venue,
      verifiedCustomers: st.verifiedCustomers,
      rewardedPurchases: st.rewardedPurchases,
      payments: st.payments,
      gross: money(st.gross),
      rewardsPaid: money(st.rewardsPaid),
      rewardsReturned: money(st.rewardsReturned),
      costPerVerifiedCustomer: cpvc === null ? null : money(cpvc),
      ...(st.venueReceived !== undefined ? { venueReceived: money(st.venueReceived) } : {}),
      ...(st.cashbackPaid !== undefined ? { byRole: { cashback: money(st.cashbackPaid), referrer: money(st.l1Paid ?? 0n), introducer: money(st.l2Paid ?? 0n) } } : {}),
      edges: st.edges.map((e) => ({ ...e, amount: money(e.amount) })),
      source: 'streams',
    });
  });

  app.get('/relay/:id', async (req, reply) => {
    const c = await ctx.auth(req);
    const [r] = await db.select().from(relayTxs).where(eq(relayTxs.id, (req.params as { id: string }).id)).limit(1);
    if (!r || !sameAddr(r.userAddress, c.sub)) throw new ApiError('NOT_FOUND');
    return send(reply, 200, {
      id: r.id,
      kind: r.kind,
      status: r.status,
      txHash: r.hash,
      hashes: r.hashes,
      attempts: r.attempts,
      gasUsed: r.gasUsed,
      blockNumber: r.blockNumber,
      errorCode: r.errorCode,
    });
  });

  /**
   * Public relayer health. Deliberately coarse (SEC-2-08): one `enabled` flag (relayer + signing keys all present) with
   * no per-secret breakdown; address/balance only when enabled (both are public on chain anyway); remaining budget.
   */
  app.get('/relayer/status', async (_req, reply) => {
    const enabled = !!deps.relayer.address && !!deps.signers.venueSigner && !!deps.signers.attributor;
    let balance: bigint | null = null;
    if (enabled) {
      try {
        balance = await deps.chain.relayerBalance();
      } catch {
        balance = null;
      }
    }
    const b = deps.relayer.budget.snapshot();
    const floor = deps.cfg.budget.minRelayerBalance;
    const recent = await db.select({ status: relayTxs.status }).from(relayTxs).orderBy(desc(relayTxs.createdAt)).limit(20);
    return send(reply, 200, {
      enabled,
      address: enabled ? (deps.relayer.address as Address) : null,
      queueDepth: deps.relayer.queueDepth,
      balance: balance === null ? null : formatNativeAsUsdc(balance),
      reachable: enabled ? balance !== null : null,
      lowBalance: balance === null ? null : balance / 10n ** 12n < floor,
      budget: {
        hourly: { limit: money(b.hourly.limit), used: money(b.hourly.used), remaining: money(b.hourly.remaining) },
        daily: { limit: money(b.daily.limit), used: money(b.daily.used), remaining: money(b.daily.remaining) },
      },
      recentFailures: recent.filter((r) => r.status === 'failed' || r.status === 'reverted').length,
    });
  });
}
