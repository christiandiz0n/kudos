/**
 * Dependency container for the BACKEND_RELAYER routes. `buildApp` creates it once; tests inject a fake chain and
 * fixed config through `ApiDepsOverrides`.
 */
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET_CHAIN_ID, ORDER_TYPES, VOUCH_ARC_TESTNET, WEIGHTS_TYPES, vouchDomain, type Order, type Weights } from '@vouch/shared';
import { baselineAttributor, type Attributor } from './attribution/baseline';
import { Sessions } from './auth/session';
import { createViemChainClient, type ChainClient } from './chain/client';
import { loadApiConfig, type ApiConfig } from './config';
import type { DbHandle } from './db/index';
import { relayTxs } from './db/schema';
import { ApiError } from './http/errors';
import type { StreamsPort } from './ports/streams';
import { Relayer, type RelayRow, type RelayStore, type RelayerOptions } from './relayer/relayer';
import { SseHub } from './sse/hub';

export interface Signers {
  venueSigner: Address | null;
  attributor: Address | null;
  signOrder(order: Order): Promise<Hex>;
  signWeights(w: Weights): Promise<Hex>;
}

export interface ApiDeps {
  handle: DbHandle;
  cfg: ApiConfig;
  chain: ChainClient;
  relayer: Relayer;
  sessions: Sessions;
  signers: Signers;
  attributor: Attributor;
  sse: SseHub;
  streams: StreamsPort;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ApiDepsOverrides {
  cfg?: Partial<ApiConfig>;
  chain?: ChainClient;
  attributor?: Attributor;
  relayerOptions?: Partial<RelayerOptions>;
  /** Tests: replace STREAMS_INFRA's port (e.g. with createStubStreamsPort()). */
  streams?: StreamsPort;
}

export function createSigners(cfg: ApiConfig, vouch: Address = VOUCH_ARC_TESTNET.address): Signers {
  const domain = vouchDomain(ARC_TESTNET_CHAIN_ID, vouch);
  const venue = cfg.venueSignerKey ? privateKeyToAccount(cfg.venueSignerKey) : null;
  const attr = cfg.attributorKey ? privateKeyToAccount(cfg.attributorKey) : null;
  return {
    venueSigner: venue?.address ?? null,
    attributor: attr?.address ?? null,
    async signOrder(order) {
      if (!venue) throw new ApiError('SIGNING_UNAVAILABLE');
      return venue.signTypedData({ domain, types: ORDER_TYPES, primaryType: 'Order', message: order });
    },
    async signWeights(w) {
      if (!attr) throw new ApiError('SIGNING_UNAVAILABLE');
      return attr.signTypedData({ domain, types: WEIGHTS_TYPES, primaryType: 'Weights', message: w });
    },
  };
}

function rowToDb(p: Partial<RelayRow>) {
  const out: Record<string, unknown> = { updatedAt: new Date() };
  if (p.status !== undefined) out.status = p.status;
  if (p.nonce !== undefined) out.nonce = p.nonce;
  if (p.hash !== undefined) out.hash = p.hash;
  if (p.hashes !== undefined) out.hashes = p.hashes;
  if (p.attempts !== undefined) out.attempts = p.attempts;
  if (p.gasLimit !== undefined) out.gasLimit = p.gasLimit;
  if (p.maxFeePerGas !== undefined) out.maxFeePerGas = p.maxFeePerGas === null ? null : p.maxFeePerGas.toString();
  if (p.gasUsed !== undefined) out.gasUsed = p.gasUsed;
  if (p.blockNumber !== undefined) out.blockNumber = p.blockNumber;
  if (p.feeUsdc !== undefined) out.feeUsdc = p.feeUsdc;
  if (p.errorCode !== undefined) out.errorCode = p.errorCode;
  if (p.error !== undefined) out.error = p.error;
  return out;
}

export function dbRelayStore(handle: DbHandle): RelayStore {
  return {
    async insert(r) {
      await handle.db.insert(relayTxs).values({
        id: r.id,
        kind: r.kind,
        ref: r.ref,
        userAddress: r.user,
        venue: r.venue,
        status: r.status,
        hashes: [],
        attempts: 0,
      });
    },
    async update(id, p) {
      await handle.db.update(relayTxs).set(rowToDb(p)).where(eq(relayTxs.id, id));
    },
  };
}

export function createApiDeps(
  handle: DbHandle,
  streams: StreamsPort,
  overrides: ApiDepsOverrides = {},
  log: ApiDeps['log'] = () => {},
): ApiDeps {
  const cfg = loadApiConfig(process.env, overrides.cfg);
  const chain = overrides.chain ?? createViemChainClient({ rpcUrl: cfg.rpcUrl, relayerKey: cfg.relayerKey });
  const sse = new SseHub(cfg.sse);
  const relayer = new Relayer(chain, {
    maxGas: cfg.maxGas,
    maxFeePerGasCap: cfg.maxFeePerGasCap,
    receiptTimeoutMs: cfg.receiptTimeoutMs,
    maxSendAttempts: cfg.maxSendAttempts,
    limits: cfg.limits,
    budget: cfg.budget,
    store: dbRelayStore(handle),
    log,
    ...overrides.relayerOptions,
  });
  return {
    handle,
    cfg,
    chain,
    relayer,
    sessions: new Sessions(handle, cfg.sessionSecret, cfg.sessionTtlSeconds, cfg.publicWebUrl),
    signers: createSigners(cfg, chain.vouch),
    attributor: overrides.attributor ?? baselineAttributor,
    sse,
    streams: overrides.streams ?? streams,
    log,
  };
}

/** Restore the last 24 h of relayer spend into the budget (so a restart does not reset it, D-808). */
export async function seedRelayerBudget(deps: ApiDeps): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const rows = await deps.handle.db
    .select({ id: relayTxs.id, createdAt: relayTxs.createdAt, fee: relayTxs.feeUsdc, user: relayTxs.userAddress, venue: relayTxs.venue })
    .from(relayTxs)
    .where(and(gt(relayTxs.createdAt, since), isNotNull(relayTxs.feeUsdc)));
  deps.relayer.budget.seed(rows.map((r) => ({ id: r.id, at: r.createdAt.getTime(), cost: r.fee!, user: r.user, venue: r.venue })));
  return rows.length;
}
