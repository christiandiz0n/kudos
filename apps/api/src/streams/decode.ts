import { decodeEventLog, type Hex } from 'viem';
import { VOUCH_ARC_TESTNET, VOUCH_EVENT_TOPICS, vouchAbi } from '@vouch/shared';
import { collectLogs } from '../routes/webhooks';

/**
 * Delivery body → decoded Vouch events. Pure functions, shared by the live webhook path, the raw replay and the
 * chain backfill (so all three produce identical rows).
 *
 * Accepts envelope v1 (our filter's output, D-302) and, defensively, any raw/nested `logs` shape (collectLogs).
 * A log is kept only if: address ∈ watched addresses (default: Vouch v3 only, so USDC 0x3600… and the EIP-7708
 * system emitter 0xffff…fffe never count), topic0 ∈ the 10 production Vouch topics, `removed` is false, and it
 * decodes strictly with `vouchAbi`. Everything else is counted in `ignored` and dropped.
 */

/** The 10 production events (no EIP712DomainChanged), same set as the `--events vouch` filter preset. */
export const HANDLED_EVENTS = [
  'VenueRegistered',
  'TermsUpdated',
  'VenueKeysUpdated',
  'SeedAmbassadorSet',
  'IntroAccepted',
  'IntroDropped',
  'CustomerVerified',
  'PaymentSettled',
  'RewardPaid',
  'RewardReturned',
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

const TOPIC_TO_EVENT: Record<string, HandledEvent> = Object.fromEntries(
  HANDLED_EVENTS.map((name) => [VOUCH_EVENT_TOPICS[name].toLowerCase(), name]),
);

export const DEFAULT_ADDRESSES: readonly string[] = [VOUCH_ARC_TESTNET.address.toLowerCase()];

export interface DecodedEvent {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string | null;
  txIndex: number | null;
  address: string;
  event: HandledEvent;
  topic0: string;
  args: Record<string, string | number | boolean>;
  topics: string[];
  data: string;
  blockTimestamp: number | null;
}

export interface IgnoredCounts {
  address: number;
  topic: number;
  removed: number;
  invalid: number;
}

export interface DecodedBatch {
  /** Logs found in the body (any shape). */
  logs: number;
  /** Kept events, sorted by (blockNumber, logIndex), duplicates within the body collapsed. */
  events: DecodedEvent[];
  ignored: IgnoredCounts;
  /** Envelope batch range when present. */
  batchStart: number | null;
  batchEnd: number | null;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.length > 0) {
    const n = v.startsWith('0x') ? Number.parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Decoded viem args → JSON-safe values (bigint → decimal string; addresses stay checksummed; bytes lowercase). */
function jsonArgs(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'bigint') out[k] = v.toString();
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = /^0x[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : v;
    else out[k] = String(v);
  }
  return out;
}

export function compareEvents(a: { blockNumber: number; logIndex: number }, b: { blockNumber: number; logIndex: number }): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

export function decodeDelivery(body: unknown, addresses: readonly string[] = DEFAULT_ADDRESSES): DecodedBatch {
  const watched = new Set(addresses.map((a) => a.toLowerCase()));
  const raw = collectLogs(body);
  const ignored: IgnoredCounts = { address: 0, topic: 0, removed: 0, invalid: 0 };
  const byKey = new Map<string, DecodedEvent>();
  for (const log of raw) {
    const address = typeof log.address === 'string' ? log.address.toLowerCase() : '';
    if (!watched.has(address)) {
      ignored.address++;
      continue;
    }
    const topics = (log.topics as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase());
    const event = topics[0] ? TOPIC_TO_EVENT[topics[0]] : undefined;
    if (!event) {
      ignored.topic++;
      continue;
    }
    if (log.removed === true) {
      ignored.removed++;
      continue;
    }
    const txHash = typeof log.transactionHash === 'string' ? log.transactionHash.toLowerCase() : null;
    const blockNumber = toNum(log.blockNumber);
    const logIndex = toNum(log.logIndex);
    const data = typeof log.data === 'string' ? log.data.toLowerCase() : '0x';
    if (!txHash || blockNumber === null || logIndex === null) {
      ignored.invalid++;
      continue;
    }
    let args: Record<string, unknown>;
    try {
      const d = decodeEventLog({ abi: vouchAbi, topics: topics as [Hex, ...Hex[]], data: data as Hex, strict: true });
      if (d.eventName !== event) throw new Error(`topic/event mismatch ${d.eventName}`);
      args = d.args as Record<string, unknown>;
    } catch {
      ignored.invalid++;
      continue;
    }
    const ev: DecodedEvent = {
      txHash,
      logIndex,
      blockNumber,
      blockHash: typeof log.blockHash === 'string' ? log.blockHash.toLowerCase() : null,
      txIndex: toNum(log.transactionIndex),
      address,
      event,
      topic0: topics[0]!,
      args: jsonArgs(args),
      topics,
      data,
      blockTimestamp: toNum(log.blockTimestamp),
    };
    byKey.set(`${txHash}:${logIndex}`, ev);
  }
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const meta = (o.metadata && typeof o.metadata === 'object' ? o.metadata : {}) as Record<string, unknown>;
  return {
    logs: raw.length,
    events: [...byKey.values()].sort(compareEvents),
    ignored,
    batchStart: toNum(o.batchStart ?? meta.batch_start_range),
    batchEnd: toNum(o.batchEnd ?? meta.batch_end_range),
  };
}
