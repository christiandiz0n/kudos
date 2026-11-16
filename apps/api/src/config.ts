/**
 * BACKEND_RELAYER configuration (Phase 2). Kept separate from `env.ts` (STREAMS_INFRA's) so the two agents never edit
 * the same file. Secrets come ONLY from env var names (D-003): RELAYER_PRIVATE_KEY, ATTRIBUTOR_PRIVATE_KEY,
 * VENUE_SIGNER_PRIVATE_KEY, SESSION_SECRET. Placeholders (`0x__…__`) and empty values count as unset; the
 * features that need them then answer 503 instead of guessing.
 */
import type { Hex } from 'viem';
import { ARC_TESTNET_RPC_URL } from '@vouch/shared';
import { realSecret } from './env';

export interface RelayerLimits {
  /** Max relayed txs per user (session address or IP) per minute. */
  perUserPerMinute: number;
  /** Max relayed txs per minute across all users. */
  globalPerMinute: number;
  /** Max jobs waiting in the relayer queue before new ones are refused (RELAYER_BUSY). */
  maxQueue: number;
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
}

export type RelayKind = 'registerVenue' | 'updateTerms' | 'setKeys' | 'setSeedAmbassador' | 'acceptIntro' | 'pay';

function key(v: string | undefined): Hex | undefined {
  const s = realSecret(v)?.trim();
  if (!s || !/^0x[0-9a-fA-F]{64}$/.test(s)) return undefined;
  return s as Hex;
}

function int(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
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

export function loadApiConfig(e: NodeJS.ProcessEnv = process.env, overrides: Partial<ApiConfig> = {}): ApiConfig {
  const payCap = e.RELAYER_MAX_GAS_PAY ? BigInt(int(e.RELAYER_MAX_GAS_PAY, 1_200_000)) : DEFAULT_MAX_GAS.pay;
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
    },
    ...overrides,
  };
}
