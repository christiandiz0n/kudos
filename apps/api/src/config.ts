/**
 * BACKEND_RELAYER configuration (Phase 2). Kept separate from `env.ts` (STREAMS_INFRA's) so the two agents never edit
 * the same file. Secrets come ONLY from env var names (D-003): RELAYER_PRIVATE_KEY, ATTRIBUTOR_PRIVATE_KEY,
 * VENUE_SIGNER_PRIVATE_KEY, SESSION_SECRET. Placeholders (`0x__…__`) and empty values count as unset; the
 * features that need them then answer 503 instead of guessing.
 *
 * Every non-secret knob has a conservative default sized for a hackathon demo wallet (~$20 of testnet USDC).
 */
import type { Hex } from 'viem';
import { ARC_TESTNET_RPC_URL, parseUsdc } from '@vouch/shared';
import { realSecret } from './env';

export type RelayKind = 'registerVenue' | 'updateTerms' | 'setKeys' | 'setSeedAmbassador' | 'acceptIntro' | 'pay';

export interface RelayerLimits {
  /** Max relayed txs per user (session address) per minute. */
  perUserPerMinute: number;
  /** Max relayed txs per minute across all users. */
  globalPerMinute: number;
  /** Max jobs waiting in the relayer queue before new ones are refused (RELAYER_BUSY). */
  maxQueue: number;
  /** Queue slots only `pay` may use (non-pay jobs are refused once depth ≥ maxQueue − payReserve). */
  payReserve?: number;
  /** Per-user count quotas by kind (D-808): [max, windowMs]. */
  kindQuota?: Partial<Record<RelayKind, { max: number; windowMs: number }>>;
}

/** Spend budget in USDC base units (6-dec). Reservations are gasLimit × maxFeePerGas, settled to the actual fee. */
export interface SpendBudgetConfig {
  globalHourly: bigint;
  globalDaily: bigint;
  perUserHourly: bigint;
  perUserDaily: bigint;
  perVenueHourly: bigint;
  perVenueDaily: bigint;
  /** Relayer native balance floor (USDC base units): below it, relays stop (RELAYER_UNDERFUNDED) and a warning is logged. */
  minRelayerBalance: bigint;
}

/** Per-IP request limits per minute by route class (D-809). */
export interface RouteLimits {
  auth: number;
  spend: number;
  write: number;
  read: number;
  sse: number;
}

export interface SseLimits {
  maxConnections: number;
  maxPerIp: number;
  maxPerChannel: number;
  /** Connections are closed after this age (clients reconnect via `retry:`). */
  maxAgeMs: number;
  heartbeatMs: number;
  /** A client whose unsent buffer exceeds this is dropped (slow consumer). */
  maxBufferedBytes: number;
}

export interface ApiConfig {
  rpcUrl: string;
  relayerKey: Hex | undefined;
  attributorKey: Hex | undefined;
  venueSignerKey: Hex | undefined;
  sessionSecret: string | undefined;
  /** Session lifetime (seconds). */
  sessionTtlSeconds: number;
  /** Base URL of the web app, used to build intro link URLs. */
  publicWebUrl: string;
  /** Max-gas guard: per-call caps (gas units). Estimates (with headroom) above the cap are refused, nothing is sent. */
  maxGas: Record<RelayKind, bigint>;
  /** Max fee guard (wei per gas, 18-dec native). Fee bumps never exceed it. */
  maxFeePerGasCap: bigint;
  /** How long to wait for a receipt before re-sending the same nonce with a bumped fee. */
  receiptTimeoutMs: number;
  /** Fee-bump attempts per job (replacement txs) before giving up. */
  maxSendAttempts: number;
  limits: RelayerLimits;
  budget: SpendBudgetConfig;
  routeLimits: RouteLimits;
  sse: SseLimits;
  /** Minimum amount for an order the API signs (base units), so the relayer isn't paying gas for dust payments. */
  minOrderAmount: bigint;
}

function key(v: string | undefined): Hex | undefined {
  const s = realSecret(v)?.trim();
  if (!s || !/^0x[0-9a-fA-F]{64}$/.test(s)) return undefined;
  return s as Hex;
}

function int(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

/** "$1.50" / "1.5" → base units; invalid → default. */
function usd(v: string | undefined, dflt: string): bigint {
  try {
    return parseUsdc(v && v.trim() ? v : dflt);
  } catch {
    return parseUsdc(dflt);
  }
}

/**
 * Gas caps. Live: registerVenue ~179k, setSeedAmbassador ~64k, acceptIntro ~160-175k, canonical pay ~410k; worst-case
 * pay (5 referrers + 5 introducers, each reward transfer needs >= 100k gas left, D-517) >= 804,619 (MSG-040).
 */
export const DEFAULT_MAX_GAS: Record<RelayKind, bigint> = {
  registerVenue: 400_000n,
  updateTerms: 200_000n,
  setKeys: 200_000n,
  setSeedAmbassador: 200_000n,
  acceptIntro: 350_000n,
  pay: 1_200_000n,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function loadApiConfig(e: NodeJS.ProcessEnv = process.env, overrides: Partial<ApiConfig> = {}): ApiConfig {
  const payCap = e.RELAYER_MAX_GAS_PAY ? BigInt(int(e.RELAYER_MAX_GAS_PAY, 1_200_000)) : DEFAULT_MAX_GAS.pay;
  const ownerPerHour = int(e.RELAYER_QUOTA_OWNER_ACTIONS_PER_HOUR, 20);
  return {
    rpcUrl: e.ARC_RPC_URL || ARC_TESTNET_RPC_URL,
    relayerKey: key(e.RELAYER_PRIVATE_KEY),
    attributorKey: key(e.ATTRIBUTOR_PRIVATE_KEY),
    venueSignerKey: key(e.VENUE_SIGNER_PRIVATE_KEY),
    sessionSecret: realSecret(e.SESSION_SECRET),
    sessionTtlSeconds: int(e.SESSION_TTL_SECONDS, 7 * 24 * 3600),
    publicWebUrl: (e.PUBLIC_WEB_URL || 'http://localhost:3100').replace(/\/$/, ''),
    maxGas: { ...DEFAULT_MAX_GAS, pay: payCap },
    maxFeePerGasCap: BigInt(int(e.RELAYER_MAX_FEE_GWEI, 200)) * 1_000_000_000n,
    receiptTimeoutMs: int(e.RELAYER_RECEIPT_TIMEOUT_MS, 30_000),
    maxSendAttempts: int(e.RELAYER_MAX_SEND_ATTEMPTS, 4),
    limits: {
      perUserPerMinute: int(e.RELAYER_RATE_PER_USER_PER_MIN, 12),
      globalPerMinute: int(e.RELAYER_RATE_GLOBAL_PER_MIN, 120),
      maxQueue: int(e.RELAYER_MAX_QUEUE, 50),
      payReserve: int(e.RELAYER_PAY_RESERVE, 20),
      kindQuota: {
        registerVenue: { max: int(e.RELAYER_QUOTA_REGISTER_PER_DAY, 3), windowMs: DAY },
        updateTerms: { max: ownerPerHour, windowMs: HOUR },
        setKeys: { max: ownerPerHour, windowMs: HOUR },
        setSeedAmbassador: { max: ownerPerHour, windowMs: HOUR },
        acceptIntro: { max: int(e.RELAYER_QUOTA_ACCEPTS_PER_HOUR, 20), windowMs: HOUR },
        pay: { max: int(e.RELAYER_QUOTA_PAYS_PER_HOUR, 30), windowMs: HOUR },
      },
    },
    budget: {
      globalHourly: usd(e.RELAYER_BUDGET_HOURLY_USDC, '1.00'),
      globalDaily: usd(e.RELAYER_BUDGET_DAILY_USDC, '5.00'),
      perUserHourly: usd(e.RELAYER_BUDGET_USER_HOURLY_USDC, '0.20'),
      perUserDaily: usd(e.RELAYER_BUDGET_USER_DAILY_USDC, '0.50'),
      perVenueHourly: usd(e.RELAYER_BUDGET_VENUE_HOURLY_USDC, '0.50'),
      perVenueDaily: usd(e.RELAYER_BUDGET_VENUE_DAILY_USDC, '2.00'),
      minRelayerBalance: usd(e.RELAYER_MIN_BALANCE_USDC, '2.00'),
    },
    routeLimits: {
      auth: int(e.RATE_AUTH_PER_MIN, 20),
      spend: int(e.RATE_SPEND_PER_MIN, 20),
      write: int(e.RATE_WRITE_PER_MIN, 60),
      read: int(e.RATE_READ_PER_MIN, 300),
      sse: int(e.RATE_SSE_PER_MIN, 20),
    },
    sse: {
      maxConnections: int(e.SSE_MAX_CONNECTIONS, 500),
      maxPerIp: int(e.SSE_MAX_PER_IP, 8),
      maxPerChannel: int(e.SSE_MAX_PER_CHANNEL, 100),
      maxAgeMs: int(e.SSE_MAX_AGE_MS, 30 * 60_000),
      heartbeatMs: int(e.SSE_HEARTBEAT_MS, 15_000),
      maxBufferedBytes: int(e.SSE_MAX_BUFFERED_BYTES, 256 * 1024),
    },
    minOrderAmount: usd(e.ORDER_MIN_USDC, '0.50'),
    ...overrides,
  };
}
