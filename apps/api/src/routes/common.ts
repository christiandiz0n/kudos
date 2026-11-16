import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyTypedData, type Address, type Hex, type TypedDataDomain } from 'viem';
import { ARC_TESTNET_CHAIN_ID, vouchDomain } from '@vouch/shared';
import type { SessionClaims } from '../auth/session';
import { tokenFrom } from '../auth/session';
import { ApiError } from '../http/errors';
import { toJson } from '../http/json';
import type { ApiDeps } from '../services';

export interface Ctx {
  deps: ApiDeps;
  domain: TypedDataDomain;
  /** Session claims or 401. */
  auth(req: FastifyRequest): Promise<SessionClaims>;
  optionalAuth(req: FastifyRequest): Promise<SessionClaims | null>;
  ipKey(req: FastifyRequest): string;
}

export function createCtx(deps: ApiDeps): Ctx {
  return {
    deps,
    domain: vouchDomain(ARC_TESTNET_CHAIN_ID, deps.chain.vouch),
    async auth(req) {
      const c = await deps.sessions.authenticate(tokenFrom(req));
      if (!c) throw new ApiError('UNAUTHENTICATED');
      return c;
    },
    async optionalAuth(req) {
      return deps.sessions.authenticate(tokenFrom(req));
    },
    ipKey(req) {
      return createHash('sha256').update(`vouch-ip:${req.ip}`).digest('hex').slice(0, 32);
    },
  };
}

/** Typed data for the client to sign; uint fields are decimal strings (convert to BigInt before signing). */
export function typedDataJson(domain: TypedDataDomain, types: Record<string, readonly { name: string; type: string }[]>, primaryType: string, message: Record<string, unknown>) {
  return toJson({ domain, types, primaryType, message });
}

export async function verifyTyped(
  address: Address,
  domain: TypedDataDomain,
  types: Record<string, readonly { name: string; type: string }[]>,
  primaryType: string,
  message: Record<string, unknown>,
  signature: Hex,
): Promise<void> {
  let ok = false;
  try {
    // biome-ignore lint: viem's generic typed-data signature is too strict for a runtime-chosen primaryType
    ok = await verifyTypedData({ address, domain, types: types as any, primaryType, message: message as any, signature });
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiError('INVALID_SIGNATURE');
}

export function send(reply: FastifyReply, status: number, body: unknown) {
  return reply.code(status).type('application/json').send(JSON.stringify(toJson(body)));
}

export const randomHex32 = (): Hex => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as Hex;

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function shortCode(len = 9): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += B62[b % 62];
  return s;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'venue'
  );
}
