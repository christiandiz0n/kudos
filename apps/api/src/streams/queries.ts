import { and, asc, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { getAddress, type Address, type Hex } from 'viem';
import type { DbHandle } from '../db/index';
import type * as appSchema from '../db/schema';
import { CURSOR_ID } from './ingest';
import { evAmbassadors, evCursor, evIntros, evPayments, evRewards, evSeeds, evTerms, evVenues, evVenueStats, evVerified } from './schema';
import type {
  AmbassadorRecord,
  IntroAcceptedRow,
  RewardLine,
  SettledPayment,
  StreamsCursor,
  StreamsQueries,
  VenueOnchain,
  VenueStats,
} from './types';

/**
 * Read API over the ev_* tables (StreamsQueries, MSG-062/063). Reads ONLY Streams-derived rows, never relayer state:
 * `getPayment(...) !== null` is the definition of "settled" (QE-C-10: the actual split comes from PaymentSettled /
 * RewardPaid / RewardReturned, never from the quote).
 */

type Db = PgliteDatabase<typeof appSchema>;

/** Checksummed when valid; otherwise returned unchanged (so it simply matches nothing). */
const addr = (a: string): string => {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};
const hex = (h: string) => h.toLowerCase();
const big = (v: string | number | null | undefined) => BigInt(v ?? 0);
const lim = (l: number | undefined, def = 50) => Math.max(1, Math.min(l ?? def, 500));

type RewardRow = typeof evRewards.$inferSelect;
type PaymentRow = typeof evPayments.$inferSelect;
type IntroRow = typeof evIntros.$inferSelect;

export function toLine(r: RewardRow): RewardLine {
  return {
    orderId: r.orderId as Hex,
    venue: r.venue as Address,
    customer: r.customer as Address,
    role: r.role as 0 | 1 | 2,
    recipient: r.recipient as Address,
    amount: big(r.amount),
    viaReferrer: r.viaReferrer as Address,
    returned: r.returned,
    returnReason: r.returnReason,
    txHash: r.txHash as Hex,
    logIndex: r.logIndex,
    blockNumber: BigInt(r.blockNumber),
    blockTime: r.blockTimestamp,
  };
}

function toPayment(p: PaymentRow, lines: RewardLine[]): SettledPayment {
  return {
    venue: p.venue as Address,
    customer: p.customer as Address,
    orderId: p.orderId as Hex,
    amount: big(p.amount),
    venueAmount: big(p.venueAmount),
    rewardPool: big(p.rewardPool),
    firstPurchase: p.firstPurchase,
    rewarded: p.rewarded,
    weightsMode: p.weightsMode,
    txHash: p.txHash as Hex,
    logIndex: p.logIndex,
    blockNumber: BigInt(p.blockNumber),
    blockTime: p.blockTimestamp,
    lines,
  };
}

export function toIntro(r: IntroRow): IntroAcceptedRow {
  return {
    venue: r.venue as Address,
    referrer: r.referrer as Address,
    customer: r.customer as Address,
    introHash: r.introHash as Hex,
    termsVersion: r.termsVersion,
    linkType: r.linkType,
    expiresAt: BigInt(r.expiresAt),
    txHash: r.txHash as Hex,
    logIndex: r.logIndex,
    blockNumber: BigInt(r.blockNumber),
    blockTime: r.blockTimestamp,
    live: r.live,
  };
}

export function createQueries(handle: DbHandle): StreamsQueries {
  const db = () => handle.db as Db;

  async function withLines(rows: PaymentRow[]): Promise<SettledPayment[]> {
    if (rows.length === 0) return [];
    const txs = [...new Set(rows.map((p) => p.txHash))];
    const lines = await db().select().from(evRewards).where(inArray(evRewards.txHash, txs)).orderBy(asc(evRewards.blockNumber), asc(evRewards.logIndex));
    return rows.map((p) =>
      toPayment(
        p,
        lines.filter((l) => l.venue === p.venue && l.orderId === p.orderId).map(toLine),
      ),
    );
  }

  return {
    async getPayment(venue, orderId) {
      const rows = await db().select().from(evPayments).where(and(eq(evPayments.venue, addr(venue)), eq(evPayments.orderId, hex(orderId))));
      return (await withLines(rows))[0] ?? null;
    },

    async getPaymentByTx(txHash) {
      const rows = await db().select().from(evPayments).where(eq(evPayments.txHash, hex(txHash))).orderBy(asc(evPayments.logIndex)).limit(1);
      return (await withLines(rows))[0] ?? null;
    },

    async listPayments(f) {
      const conds: SQL[] = [];
      if (f.venue) conds.push(eq(evPayments.venue, addr(f.venue)));
      if (f.customer) conds.push(eq(evPayments.customer, addr(f.customer)));
      if (f.before) {
        const b = Number(f.before.blockNumber);
        conds.push(or(lt(evPayments.blockNumber, b), and(eq(evPayments.blockNumber, b), lt(evPayments.logIndex, f.before.logIndex)))!);
      }
      const rows = await db()
        .select()
        .from(evPayments)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(evPayments.blockNumber), desc(evPayments.logIndex))
        .limit(lim(f.limit));
      return withLines(rows);
    },

    async listRewardLines(f) {
      const conds: SQL[] = [];
      if (f.recipient) conds.push(eq(evRewards.recipient, addr(f.recipient)));
      if (f.venue) conds.push(eq(evRewards.venue, addr(f.venue)));
      const rows = await db()
        .select()
        .from(evRewards)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(evRewards.blockNumber), desc(evRewards.logIndex))
        .limit(lim(f.limit));
      return rows.map(toLine);
    },

    async listIntrosAccepted(f) {
      const conds: SQL[] = [];
      if (f.venue) conds.push(eq(evIntros.venue, addr(f.venue)));
      if (f.customer) conds.push(eq(evIntros.customer, addr(f.customer)));
      if (f.referrer) conds.push(eq(evIntros.referrer, addr(f.referrer)));
      const rows = await db()
        .select()
        .from(evIntros)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(evIntros.blockNumber), desc(evIntros.logIndex))
        .limit(lim(f.limit));
      return rows.map(toIntro);
    },

    async getVenue(venue): Promise<VenueOnchain | null> {
      const v = addr(venue);
      const [row] = await db().select().from(evVenues).where(eq(evVenues.venue, v));
      if (!row) return null;
      const terms = await db().select().from(evTerms).where(eq(evTerms.venue, v)).orderBy(asc(evTerms.termsVersion));
      const seeds = await db()
        .select({ a: evSeeds.ambassador })
        .from(evSeeds)
        .where(and(eq(evSeeds.venue, v), eq(evSeeds.allowed, true)))
        .orderBy(asc(evSeeds.ambassador));
      return {
        venue: row.venue as Address,
        owner: row.owner as Address,
        salt: row.salt as Hex,
        payout: row.payout as Address,
        signer: row.signer as Address,
        attributor: row.attributor as Address,
        metadataURI: row.metadataUri,
        terms: terms.map((t) => ({ termsVersion: t.termsVersion, rewardBps: t.rewardBps, minOrder: big(t.minOrder), effectiveAt: BigInt(t.effectiveAt) })),
        seeds: seeds.map((s) => s.a as Address),
        registeredTx: row.registeredTx as Hex,
        blockNumber: BigInt(row.registeredBlock),
      };
    },

    async getVenueStats(venue): Promise<VenueStats> {
      const v = addr(venue);
      const [s] = await db().select().from(evVenueStats).where(eq(evVenueStats.venue, v));
      const paid = await db()
        .select()
        .from(evRewards)
        .where(and(eq(evRewards.venue, v), eq(evRewards.returned, false)))
        .orderBy(asc(evRewards.blockNumber), asc(evRewards.logIndex));
      const rewardedCustomers = await db()
        .selectDistinct({ c: evPayments.customer })
        .from(evPayments)
        .where(and(eq(evPayments.venue, v), eq(evPayments.rewarded, true)));
      return {
        venue: v as Address,
        verifiedCustomers: s?.verifiedCustomers ?? 0,
        rewardedPurchases: s?.rewardedPayments ?? 0,
        payments: s?.payments ?? 0,
        gross: big(s?.gross),
        rewardsPaid: big(s?.rewardsPaid),
        rewardsReturned: big(s?.rewardsReturned),
        venueReceived: big(s?.venueReceived),
        cashbackPaid: big(s?.cashbackPaid),
        l1Paid: big(s?.l1Paid),
        l2Paid: big(s?.l2Paid),
        rewardedCustomers: rewardedCustomers.length,
        edges: paid.map((r) => ({
          orderId: r.orderId as Hex,
          from: (r.role === 2 ? r.viaReferrer : r.customer) as Address,
          to: r.recipient as Address,
          role: r.role as 0 | 1 | 2,
          amount: big(r.amount),
          txHash: r.txHash as Hex,
        })),
      };
    },

    async getAmbassador(address): Promise<AmbassadorRecord> {
      const a = addr(address);
      const rows = await db().select().from(evAmbassadors).where(eq(evAmbassadors.address, a)).orderBy(asc(evAmbassadors.venue));
      const lines = await db()
        .select()
        .from(evRewards)
        .where(eq(evRewards.recipient, a))
        .orderBy(desc(evRewards.blockNumber), desc(evRewards.logIndex))
        .limit(50);
      return {
        address: a as Address,
        customersCredited: rows.reduce((acc, r) => acc + r.customersCredited, 0),
        venues: rows.filter((r) => r.customersCredited > 0).map((r) => r.venue as Address),
        l1Earned: rows.reduce((acc, r) => acc + big(r.l1Earned), 0n),
        l2Earned: rows.reduce((acc, r) => acc + big(r.l2Earned), 0n),
        cashbackEarned: rows.reduce((acc, r) => acc + big(r.cashbackEarned), 0n),
        lines: lines.map(toLine),
      };
    },

    async isVerified(venue, customer) {
      const rows = await db()
        .select({ c: evVerified.customer })
        .from(evVerified)
        .where(and(eq(evVerified.venue, addr(venue)), eq(evVerified.customer, addr(customer))))
        .limit(1);
      return rows.length > 0;
    },

    async cursor(): Promise<StreamsCursor> {
      const [c] = await db().select().from(evCursor).where(eq(evCursor.id, CURSOR_ID));
      return {
        lastBlock: c?.lastBlock != null ? BigInt(c.lastBlock) : null,
        lastIngestAt: c ? c.updatedAt.toISOString() : null,
        lastLogIndex: c?.lastLogIndex ?? null,
        events: c?.events ?? 0,
      };
    },
  };
}
