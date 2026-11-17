/**
 * Sign-in (D-802): the browser wallet key (passkey-gated local EOA, D-104) signs a one-time server challenge as an
 * EIP-191 personal message. The server verifies it (viem verifyMessage), upserts the user and issues a session token
 *   token = "v1." + b64url(JSON{sid, sub, exp}) + "." + b64url(HMAC-SHA256(SESSION_SECRET, "v1." + payload))
 * The `sessions` row makes logout/revocation possible. Tokens travel as `Authorization: Bearer`, the `vouch_session`
 * cookie, or `?token=` (SSE only: EventSource cannot set headers). No SESSION_SECRET → auth answers 503 (fail closed).
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { APP_NAME, ARC_TESTNET_CHAIN_ID } from '@vouch/shared';
import type { DbHandle } from '../db/index';
import { authChallenges, sessions, users } from '../db/schema';
import { ApiError } from '../http/errors';

export const CHALLENGE_TTL_SECONDS = 300;

export interface SessionClaims {
  sid: string;
  sub: Address;
  exp: number;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signToken(secret: string, claims: SessionClaims): string {
  const payload = `v1.${b64u(JSON.stringify(claims))}`;
  const mac = createHmac('sha256', secret).update(payload).digest();
  return `${payload}.${b64u(mac)}`;
}

/** Verifies MAC + expiry only (no DB). */
export function parseToken(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = createHmac('sha256', secret).update(`v1.${parts[1]}`).digest();
  let got: Buffer;
  try {
    got = Buffer.from(parts[2]!, 'base64url');
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as SessionClaims;
    if (typeof c.sid !== 'string' || typeof c.sub !== 'string' || typeof c.exp !== 'number') return null;
    if (c.exp <= nowSec) return null;
    return { ...c, sub: getAddress(c.sub) };
  } catch {
    return null;
  }
}

export function challengeMessage(address: Address, nonce: string, issuedAt: Date, expiresAt: Date, origin: string): string {
  return [
    `${APP_NAME} wants you to sign in with your account:`,
    address,
    '',
    'Sign in to Vouch. This does not move any money.',
    '',
    `URI: ${origin}`,
    `Chain ID: ${ARC_TESTNET_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

export class Sessions {
  constructor(
    private readonly handle: DbHandle,
    private readonly secret: string | undefined,
    private readonly ttlSeconds: number,
    private readonly origin = 'vouch',
  ) {}

  private need(): string {
    // Fail closed without saying which setting is missing (SEC-2-08).
    if (!this.secret) throw new ApiError('INTERNAL', { status: 503, message: 'Sign-in is unavailable right now.' });
    return this.secret;
  }

  async challenge(address: Address): Promise<{ challengeId: string; message: string; expiresAt: string }> {
    this.need();
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const message = challengeMessage(address, randomBytes(16).toString('hex'), now, expiresAt, this.origin);
    await this.handle.db.insert(authChallenges).values({ id, address, message, expiresAt });
    // Bounded growth: drop challenges that expired over an hour ago (cheap, indexed by PK scan on a small table).
    if (Math.random() < 0.05) await this.handle.db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date(Date.now() - 3_600_000))).catch(() => {});
    return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
  }

  async verify(input: {
    address: Address;
    challengeId: string;
    signature: Hex;
    displayName?: string | undefined;
    passkeyCredentialId?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ token: string; expiresAt: string; user: { address: Address; displayName: string | null } }> {
    const secret = this.need();
    const db = this.handle.db;
    const [ch] = await db.select().from(authChallenges).where(eq(authChallenges.id, input.challengeId)).limit(1);
    if (!ch || ch.address.toLowerCase() !== input.address.toLowerCase()) throw new ApiError('UNAUTHENTICATED', { details: { reason: 'unknown challenge' } });
    if (ch.usedAt) throw new ApiError('UNAUTHENTICATED', { details: { reason: 'challenge already used' } });
    if (ch.expiresAt.getTime() < Date.now()) throw new ApiError('UNAUTHENTICATED', { details: { reason: 'challenge expired' } });
    let ok = false;
    try {
      ok = await verifyMessage({ address: input.address, message: ch.message, signature: input.signature });
    } catch {
      ok = false;
    }
    if (!ok) throw new ApiError('INVALID_SIGNATURE');
    // Single use: only the first verify wins.
    const res = (await db.execute(sql`update auth_challenges set used_at = now() where id = ${ch.id} and used_at is null returning id`)) as unknown;
    const used = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
    if (used.length !== 1) throw new ApiError('UNAUTHENTICATED', { details: { reason: 'challenge already used' } });

    const address = getAddress(input.address);
    const [existing] = await db.select().from(users).where(eq(users.address, address)).limit(1);
    if (existing) {
      await db
        .update(users)
        .set({
          lastSeenAt: new Date(),
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.passkeyCredentialId ? { passkeyCredentialId: input.passkeyCredentialId } : {}),
        })
        .where(eq(users.address, address));
    } else {
      await db.insert(users).values({ address, displayName: input.displayName ?? null, passkeyCredentialId: input.passkeyCredentialId ?? null });
    }
    const sid = randomUUID();
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    await db.insert(sessions).values({ id: sid, address, expiresAt: new Date(exp * 1000), userAgent: input.userAgent?.slice(0, 200) ?? null });
    const displayName = input.displayName ?? existing?.displayName ?? null;
    return { token: signToken(secret, { sid, sub: address, exp }), expiresAt: new Date(exp * 1000).toISOString(), user: { address, displayName } };
  }

  /** Token → claims if the MAC, expiry and session row (not revoked) all check out. */
  async authenticate(token: string | undefined): Promise<SessionClaims | null> {
    if (!token || !this.secret) return null;
    const c = parseToken(this.secret, token);
    if (!c) return null;
    const [row] = await this.handle.db.select().from(sessions).where(eq(sessions.id, c.sid)).limit(1);
    if (!row || row.revokedAt || row.address.toLowerCase() !== c.sub.toLowerCase()) return null;
    return c;
  }

  async revoke(sid: string): Promise<void> {
    await this.handle.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sid));
  }
}

/**
 * `Authorization: Bearer <token>` only (SEC-2-03, SEC-2-09: no cookie, no query string). The SSE route alone also
 * accepts `?token=` via `sseTokenFrom` (EventSource cannot set headers); request logs redact it.
 */
export function tokenFrom(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const h = req.headers.authorization;
  const auth = Array.isArray(h) ? h[0] : h;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || undefined;
  return undefined;
}

export function sseTokenFrom(req: { headers: Record<string, string | string[] | undefined>; query?: unknown }): string | undefined {
  const fromHeader = tokenFrom(req);
  if (fromHeader) return fromHeader;
  const q = req.query as { token?: unknown } | undefined;
  return typeof q?.token === 'string' && q.token ? q.token : undefined;
}
