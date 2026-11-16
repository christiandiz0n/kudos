/** Shared test helpers: deterministic personas, an app wired to FakeChain, sign-in and typed-data signing. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { buildApp } from '../app';
import type { Attributor } from '../attribution/baseline';
import type { ApiConfig } from '../config';
import type { StreamsPort } from '../ports/streams';
import type { RelayerOptions } from '../relayer/relayer';
import type { ApiDeps } from '../services';
import { FakeChain } from './fake-chain';

export const keyOf = (name: string): Hex => keccak256(toHex(`vouch-test-key:${name}`));
export const acct = (name: string): PrivateKeyAccount => privateKeyToAccount(keyOf(name));

export const P = {
  relayer: acct('relayer'),
  attributor: acct('attributor'),
  venueSigner: acct('venue-signer'),
  lena: acct('lena'),
  sam: acct('sam'),
  ana: acct('ana'),
  priya: acct('priya'),
  ben: acct('ben'),
  eve: acct('eve'),
};

export const SESSION_SECRET = 'test-session-secret-0123456789abcdef';

export interface TestApp {
  app: FastifyInstance;
  chain: FakeChain;
  deps: ApiDeps;
  close(): Promise<void>;
}

export async function makeApp(
  opts: { relayer?: boolean; cfg?: Partial<ApiConfig>; streams?: StreamsPort; attributor?: Attributor; relayerOptions?: Partial<RelayerOptions> } = {},
): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-api-'));
  const chain = new FakeChain(opts.relayer === false ? null : P.relayer.address);
  const { app, deps } = await buildApp(
    { databaseUrl: 'pglite://memory', streamsSpikeLog: path.join(dir, 'streams.ndjson'), corsOrigins: ['http://localhost:3100'] },
    {
      logger: false,
      api: {
        chain,
        cfg: {
          relayerKey: opts.relayer === false ? undefined : keyOf('relayer'),
          attributorKey: keyOf('attributor'),
          venueSignerKey: keyOf('venue-signer'),
          sessionSecret: SESSION_SECRET,
          publicWebUrl: 'http://localhost:3100',
          ...opts.cfg,
        },
        relayerOptions: { pollMs: 1, sleep: async () => {}, ...opts.relayerOptions },
        ...(opts.streams ? { streams: opts.streams } : {}),
        ...(opts.attributor ? { attributor: opts.attributor } : {}),
      },
    },
  );
  return { app, chain, deps, close: () => app.close() };
}

export interface Res {
  status: number;
  body: any;
}

export async function call(app: FastifyInstance, method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: unknown): Promise<Res> {
  const r = await app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
  let body: unknown = r.body;
  try {
    body = r.json();
  } catch {
    /* not JSON */
  }
  return { status: r.statusCode, body };
}

export async function signIn(app: FastifyInstance, a: PrivateKeyAccount, displayName?: string): Promise<string> {
  const ch = await call(app, 'POST', '/auth/challenge', undefined, { address: a.address });
  if (ch.status !== 200) throw new Error(`challenge ${ch.status} ${JSON.stringify(ch.body)}`);
  const signature = await a.signMessage({ message: ch.body.message });
  const v = await call(app, 'POST', '/auth/verify', undefined, { address: a.address, challengeId: ch.body.challengeId, signature, displayName });
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.body)}`);
  return v.body.token;
}

/** Revive the API's typed data (uint fields as decimal strings) and sign it. */
export async function signTd(a: PrivateKeyAccount, td: { domain: any; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex> {
  const fields = td.types[td.primaryType]!;
  const message: Record<string, unknown> = { ...td.message };
  for (const f of fields) if (/^u?int\d*$/.test(f.type)) message[f.name] = BigInt(message[f.name] as string);
  return a.signTypedData({ domain: td.domain, types: td.types as any, primaryType: td.primaryType as any, message: message as any });
}

export const usd = (s: string) => BigInt(Math.round(Number(s) * 1_000_000));
