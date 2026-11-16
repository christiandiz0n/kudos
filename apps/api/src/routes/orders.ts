/**
 * Venue-signed orders (the QR at the counter). The API signs `Order` with VENUE_SIGNER_PRIVATE_KEY, only for venues
 * whose on-chain `signer` is that key. Order status here is the relay view (pending → relayed | failed); whether it is
 * PAID comes from Streams (`settled`).
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { zeroAddress, type Address, type Hex } from 'viem';
import { VOUCH_LIMITS } from '@vouch/shared';
import { orders, venuesMeta } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, hex, int, money, obj, sameAddr, str, uint } from '../http/json';
import { send, randomHex32, type Ctx } from './common';
import { settledView } from './views';

export const DEFAULT_ORDER_TTL = 300;
export const MAX_ORDER_TTL = 3_600;

export function registerOrderRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps } = ctx;
  const db = deps.handle.db;

  app.post('/venues/:venue/orders', async (req, reply) => {
    const c = await ctx.auth(req);
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const b = obj(req.body);
    const amount = uint(b.amount, 'amount');
    if (amount < 1n || amount > VOUCH_LIMITS.MAX_ORDER_AMOUNT) throw new ApiError('INVALID_AMOUNT');
    const ttl = b.ttlSeconds === undefined ? DEFAULT_ORDER_TTL : int(b.ttlSeconds, 'ttlSeconds', 30, MAX_ORDER_TTL);
    const label = str(b.label, 'label', 80, { optional: true });
    const onchain = await deps.chain.getVenue(venue);
    if (onchain.owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');
    if (!sameAddr(onchain.owner, c.sub)) throw new ApiError('FORBIDDEN');
    if (!deps.signers.venueSigner) throw new ApiError('SIGNING_UNAVAILABLE');
    if (!sameAddr(onchain.signer, deps.signers.venueSigner)) throw new ApiError('VENUE_NOT_MANAGED');
    const t = await deps.chain.now();
    const order = { venue, orderId: randomHex32(), amount, expiresAt: t + BigInt(ttl) };
    const signature = await deps.signers.signOrder(order);
    await db.insert(orders).values({ ...order, signature, status: 'pending', label: label ?? null, createdBy: c.sub });
    return send(reply, 201, {
      order,
      signature,
      amount: money(amount),
      expiresAt: order.expiresAt,
      qrPayload: `${deps.cfg.publicWebUrl}/pay?v=${venue}&o=${order.orderId}`,
      status: 'pending',
    });
  });

  app.get('/venues/:venue/orders', async (req, reply) => {
    const c = await ctx.auth(req);
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const [meta] = await db.select({ owner: venuesMeta.owner }).from(venuesMeta).where(eq(venuesMeta.venue, venue)).limit(1);
    const owner = meta?.owner ?? (await deps.chain.getVenue(venue)).owner;
    if (!sameAddr(owner, c.sub)) throw new ApiError('FORBIDDEN');
    const rows = await db.select().from(orders).where(eq(orders.venue, venue)).orderBy(desc(orders.createdAt)).limit(50);
    const out = await Promise.all(
      rows.map(async (o) => {
        const settled = await deps.streams.getPayment(venue, o.orderId as Hex);
        return { orderId: o.orderId, amount: money(o.amount), expiresAt: o.expiresAt, label: o.label, status: o.status, txHash: o.txHash, paid: !!settled, settled: settled ? settledView(settled) : null };
      }),
    );
    return send(reply, 200, { venue, orders: out });
  });

  /** Public: what the customer's phone fetches after scanning (the QR only carries venue + orderId). */
  app.get('/venues/:venue/orders/:orderId', async (req, reply) => {
    const p = req.params as { venue: string; orderId: string };
    const venue = addr(p.venue, 'venue');
    const orderId = hex(p.orderId, 'orderId', 32);
    const [o] = await db.select().from(orders).where(and(eq(orders.venue, venue), eq(orders.orderId, orderId))).limit(1);
    if (!o) throw new ApiError('NOT_FOUND');
    const [meta] = await db.select({ name: venuesMeta.name }).from(venuesMeta).where(eq(venuesMeta.venue, venue)).limit(1);
    const settled = await deps.streams.getPayment(venue, orderId);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const status = settled ? 'paid' : o.status === 'pending' && nowSec > o.expiresAt ? 'expired' : o.status;
    return send(reply, 200, {
      order: { venue: o.venue as Address, orderId: o.orderId as Hex, amount: o.amount, expiresAt: o.expiresAt },
      signature: o.signature,
      amount: money(o.amount),
      venueName: meta?.name ?? null,
      status,
      relayStatus: o.status,
      txHash: o.txHash,
      paid: !!settled,
      settled: settled ? settledView(settled) : null,
      waitingOnStreams: !settled && o.status === 'relayed',
    });
  });
}
