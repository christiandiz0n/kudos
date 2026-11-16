/**
 * Venue onboarding + relayed owner actions (D-501, D-013(3)).
 * Two steps each: `prepare` reads `nonces(owner)` and chain time and returns the EIP-712 message for the owner to sign;
 * `submit` re-reads the nonce, refuses if it moved (never queue a future-nonce action), verifies the signature and
 * relays. One owner action in flight per owner at a time.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import {
  REGISTER_VENUE_TYPES,
  SET_SEED_AMBASSADOR_TYPES,
  SET_VENUE_KEYS_TYPES,
  UPDATE_TERMS_TYPES,
  VOUCH_LIMITS,
  computeVenueId,
  vouchAbi,
} from '@vouch/shared';
import type { RelayKind } from '../config';
import { ownerActions, venuesMeta } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, int, money, obj, oneOf, optAddr, reqStr, sameAddr, sig, str, toJson, uint } from '../http/json';
import { SseHub } from '../sse/hub';
import { randomHex32, send, slugify, typedDataJson, verifyTyped, type Ctx } from './common';

const SIGN_WINDOW_SECONDS = 600n;
type ActionKind = 'updateTerms' | 'setKeys' | 'setSeedAmbassador';
const ACTION_TYPES = { updateTerms: UPDATE_TERMS_TYPES, setKeys: SET_VENUE_KEYS_TYPES, setSeedAmbassador: SET_SEED_AMBASSADOR_TYPES } as const;
const PRIMARY = { updateTerms: 'UpdateTerms', setKeys: 'SetVenueKeys', setSeedAmbassador: 'SetSeedAmbassador' } as const;

function checkTerms(rewardBps: number, minOrder: bigint) {
  if (rewardBps < 1 || rewardBps > VOUCH_LIMITS.MAX_REWARD_BPS || minOrder > VOUCH_LIMITS.MAX_MIN_ORDER) throw new ApiError('INVALID_TERMS');
}

/** Revive a stored message (bigints as strings) for verification / calldata. */
function revive(types: Record<string, readonly { name: string; type: string }[]>, primary: string, m: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...m };
  for (const f of types[primary]!) {
    if (/^u?int\d*$/.test(f.type)) out[f.name] = /^uint(8|16|32)$/.test(f.type) ? Number(m[f.name]) : BigInt(m[f.name] as string);
  }
  return out;
}

export function registerVenueRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps, domain } = ctx;
  const db = deps.handle.db;
  const chain = deps.chain;

  async function assertNoInflight(owner: Address) {
    const a = await db.select({ id: venuesMeta.venue }).from(venuesMeta).where(and(eq(venuesMeta.owner, owner), eq(venuesMeta.status, 'relaying'))).limit(1);
    const b = await db.select({ id: ownerActions.id }).from(ownerActions).where(and(eq(ownerActions.owner, owner), eq(ownerActions.status, 'relaying'))).limit(1);
    if (a.length || b.length) throw new ApiError('OWNER_ACTION_PENDING');
  }

  async function ownerOf(venue: Address): Promise<Address> {
    const v = await chain.getVenue(venue);
    if (v.owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');
    return v.owner;
  }

  async function uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let i = 0; i < 5; i++) {
      const [hit] = await db.select({ v: venuesMeta.venue }).from(venuesMeta).where(eq(venuesMeta.slug, slug)).limit(1);
      if (!hit) return slug;
      slug = `${base}-${randomHex32().slice(2, 7)}`;
    }
    return `${base}-${randomHex32().slice(2, 12)}`;
  }

  // ---------------------------------------------------------------- register
  app.post('/venues/prepare', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const name = reqStr(b.name, 'name', 80);
    const description = str(b.description, 'description', 500, { optional: true });
    const rewardBps = int(b.rewardBps, 'rewardBps', 1, VOUCH_LIMITS.MAX_REWARD_BPS);
    const minOrder = uint(b.minOrder ?? '0', 'minOrder');
    checkTerms(rewardBps, minOrder);
    const payout = optAddr(b.payout, 'payout') ?? c.sub;
    if (!deps.signers.venueSigner || !deps.signers.attributor) throw new ApiError('SIGNING_UNAVAILABLE');
    await assertNoInflight(c.sub);
    const slug = await uniqueSlug(slugify(typeof b.slug === 'string' && b.slug ? b.slug : name));
    const [nonce, t] = await Promise.all([chain.nonces(c.sub), chain.now()]);
    const salt = randomHex32();
    const venue = computeVenueId(c.sub, salt);
    const deadline = t + SIGN_WINDOW_SECONDS;
    const message = {
      owner: c.sub,
      salt,
      payout,
      signer: deps.signers.venueSigner,
      attributor: deps.signers.attributor,
      rewardBps,
      minOrder,
      metadataURI: `vouch://venue/${slug}`,
      nonce,
      deadline,
    };
    await db.insert(venuesMeta).values({
      venue,
      owner: c.sub,
      name,
      slug,
      description: description ?? null,
      salt,
      payout,
      signer: message.signer,
      attributor: message.attributor,
      rewardBps,
      minOrder,
      metadataUri: message.metadataURI,
      status: 'prepared',
      typedMessage: toJson(message),
      ownerNonce: nonce.toString(),
      deadline,
    });
    return send(reply, 200, { venue, slug, typedData: typedDataJson(domain, REGISTER_VENUE_TYPES, 'RegisterVenue', message) });
  });

  app.post('/venues', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const venue = addr(b.venue, 'venue');
    const signature = sig(b.signature);
    const [meta] = await db.select().from(venuesMeta).where(eq(venuesMeta.venue, venue)).limit(1);
    if (!meta || !sameAddr(meta.owner, c.sub)) throw new ApiError('NOT_FOUND');
    if (meta.status === 'registered') throw new ApiError('VENUE_EXISTS');
    if (meta.status === 'relaying') throw new ApiError('OWNER_ACTION_PENDING');
    const message = revive(REGISTER_VENUE_TYPES, 'RegisterVenue', meta.typedMessage as Record<string, unknown>);
    await verifyTyped(c.sub, domain, REGISTER_VENUE_TYPES, 'RegisterVenue', message, signature);
    const [nonce, t, onchain] = await Promise.all([chain.nonces(c.sub), chain.now(), chain.getVenue(venue)]);
    if (onchain.owner !== zeroAddress) throw new ApiError('VENUE_EXISTS');
    if (nonce !== BigInt(meta.ownerNonce)) throw new ApiError('OWNER_NONCE_STALE', { details: { signedNonce: meta.ownerNonce, currentNonce: nonce.toString() } });
    if (t > meta.deadline) throw new ApiError('SIGNATURE_EXPIRED');
    await assertNoInflight(c.sub);
    const cfg = {
      payout: message.payout as Address,
      signer: message.signer as Address,
      attributor: message.attributor as Address,
      rewardBps: message.rewardBps as number,
      minOrder: message.minOrder as bigint,
      metadataURI: message.metadataURI as string,
    };
    const data = encodeFunctionData({ abi: vouchAbi, functionName: 'registerVenue', args: [c.sub, meta.salt as Hex, cfg, meta.deadline, signature] });
    await db.update(venuesMeta).set({ status: 'relaying', updatedAt: new Date() }).where(eq(venuesMeta.venue, venue));
    let handle;
    try {
      handle = await deps.relayer.submit({ kind: 'registerVenue', data, user: c.sub, ref: `venue:${venue}` });
    } catch (e) {
      await db.update(venuesMeta).set({ status: 'failed', updatedAt: new Date() }).where(eq(venuesMeta.venue, venue));
      throw e;
    }
    await db.update(venuesMeta).set({ relayTxId: handle.id, txHash: handle.hash, updatedAt: new Date() }).where(eq(venuesMeta.venue, venue));
    deps.sse.publish(SseHub.userChannel(c.sub), 'venue.pending', { venue, txHash: handle.hash, relayId: handle.id });
    void handle.done.then(async (o) => {
      const status = o.status === 'mined' ? 'registered' : 'failed';
      await db.update(venuesMeta).set({ status, ...(o.status !== 'failed' ? { txHash: o.hash } : {}), updatedAt: new Date() }).where(eq(venuesMeta.venue, venue));
      if (status === 'failed') deps.sse.publish(SseHub.userChannel(c.sub), 'venue.failed', { venue, code: o.status === 'failed' ? o.error.code : 'TX_FAILED' });
    });
    return send(reply, 202, { venue, status: 'pending', txHash: handle.hash, relayId: handle.id });
  });

  // ---------------------------------------------------------------- reads + metadata
  async function venueView(meta: typeof venuesMeta.$inferSelect | undefined, venue: Address) {
    const onchain = await deps.streams.getVenue(venue);
    const current = onchain?.terms.at(-1) ?? null;
    return {
      venue,
      name: meta?.name ?? null,
      slug: meta?.slug ?? null,
      description: meta?.description ?? null,
      owner: onchain?.owner ?? (meta ? getAddress(meta.owner) : null),
      status: onchain ? 'registered' : (meta?.status ?? 'unknown'),
      managedByVouch: onchain ? sameAddr(onchain.signer, deps.signers.venueSigner) : meta ? sameAddr(meta.signer, deps.signers.venueSigner) : false,
      terms: current
        ? { termsVersion: current.termsVersion, rewardBps: current.rewardBps, minOrder: money(current.minOrder), effectiveAt: current.effectiveAt }
        : meta
          ? { termsVersion: null, rewardBps: meta.rewardBps, minOrder: money(meta.minOrder), effectiveAt: null, source: 'registration form' }
          : null,
      onchain,
      waitingOnStreams: !onchain,
      txHash: meta?.txHash ?? onchain?.registeredTx ?? null,
    };
  }

  app.get('/venues', async (_req, reply) => {
    const rows = await db.select().from(venuesMeta).where(inArray(venuesMeta.status, ['relaying', 'registered'])).orderBy(desc(venuesMeta.createdAt)).limit(100);
    return send(reply, 200, { venues: await Promise.all(rows.map((m) => venueView(m, getAddress(m.venue)))) });
  });

  app.get('/venues/:venue', async (req, reply) => {
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const [meta] = await db.select().from(venuesMeta).where(eq(venuesMeta.venue, venue)).limit(1);
    const v = await venueView(meta, venue);
    if (!meta && !v.onchain) throw new ApiError('UNKNOWN_VENUE');
    return send(reply, 200, v);
  });

  app.patch('/venues/:venue', async (req, reply) => {
    const c = await ctx.auth(req);
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const [meta] = await db.select().from(venuesMeta).where(eq(venuesMeta.venue, venue)).limit(1);
    if (!meta) throw new ApiError('NOT_FOUND');
    if (!sameAddr(meta.owner, c.sub)) throw new ApiError('FORBIDDEN');
    const b = obj(req.body);
    const name = str(b.name, 'name', 80, { optional: true });
    const description = str(b.description, 'description', 500, { optional: true });
    await db
      .update(venuesMeta)
      .set({ ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}), updatedAt: new Date() })
      .where(eq(venuesMeta.venue, venue));
    return send(reply, 200, { venue, name: name ?? meta.name, description: description ?? meta.description });
  });

  app.get('/venues/:venue/terms', async (req, reply) => {
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const onchain = await deps.streams.getVenue(venue);
    const terms = (onchain?.terms ?? []).map((t) => ({ ...t, minOrder: money(t.minOrder) }));
    return send(reply, 200, { venue, current: terms.at(-1) ?? null, history: terms, source: 'streams', waitingOnStreams: !onchain });
  });

  // ---------------------------------------------------------------- owner actions (updateTerms / setKeys / setSeedAmbassador)
  app.post('/venues/:venue/actions', async (req, reply) => {
    const c = await ctx.auth(req);
    const venue = addr((req.params as { venue: string }).venue, 'venue');
    const b = obj(req.body);
    const kind = oneOf(b.kind, 'kind', ['updateTerms', 'setKeys', 'setSeedAmbassador'] as const);
    const owner = await ownerOf(venue);
    if (!sameAddr(owner, c.sub)) throw new ApiError('FORBIDDEN');
    await assertNoInflight(c.sub);
    const [nonce, t] = await Promise.all([chain.nonces(owner), chain.now()]);
    const deadline = t + SIGN_WINDOW_SECONDS;
    let message: Record<string, unknown>;
    if (kind === 'updateTerms') {
      const rewardBps = int(b.rewardBps, 'rewardBps', 1, VOUCH_LIMITS.MAX_REWARD_BPS);
      const minOrder = uint(b.minOrder ?? '0', 'minOrder');
      checkTerms(rewardBps, minOrder);
      message = { venue, rewardBps, minOrder, nonce, deadline };
    } else if (kind === 'setKeys') {
      const cur = await chain.getVenue(venue);
      message = {
        venue,
        payout: optAddr(b.payout, 'payout') ?? cur.payout,
        signer: optAddr(b.signer, 'signer') ?? cur.signer,
        attributor: optAddr(b.attributor, 'attributor') ?? cur.attributor,
        nonce,
        deadline,
      };
    } else {
      const allowed = b.allowed === undefined ? true : b.allowed === true;
      message = { venue, ambassador: addr(b.ambassador, 'ambassador'), allowed, nonce, deadline };
    }
    const id = crypto.randomUUID();
    // Only the newest prepared action at this nonce can succeed; mark older prepared ones superseded.
    await db.update(ownerActions).set({ status: 'superseded', updatedAt: new Date() }).where(and(eq(ownerActions.owner, owner), eq(ownerActions.status, 'prepared')));
    await db.insert(ownerActions).values({ id, venue, owner, kind, typedMessage: toJson(message), ownerNonce: nonce.toString(), deadline });
    return send(reply, 200, { actionId: id, kind, typedData: typedDataJson(domain, ACTION_TYPES[kind], PRIMARY[kind], message) });
  });

  app.post('/venues/:venue/actions/:id', async (req, reply) => {
    const c = await ctx.auth(req);
    const { venue: v, id } = req.params as { venue: string; id: string };
    const venue = addr(v, 'venue');
    const signature = sig(obj(req.body).signature);
    const [a] = await db.select().from(ownerActions).where(and(eq(ownerActions.id, id), eq(ownerActions.venue, venue))).limit(1);
    if (!a || !sameAddr(a.owner, c.sub)) throw new ApiError('NOT_FOUND');
    if (a.status === 'superseded') throw new ApiError('OWNER_NONCE_STALE', { details: { reason: 'a newer change was prepared' } });
    if (a.status !== 'prepared') throw new ApiError('OWNER_ACTION_PENDING', { details: { status: a.status } });
    const kind = a.kind as ActionKind;
    const types = ACTION_TYPES[kind];
    const message = revive(types, PRIMARY[kind], a.typedMessage as Record<string, unknown>);
    await verifyTyped(c.sub, domain, types, PRIMARY[kind], message, signature);
    const [nonce, t] = await Promise.all([chain.nonces(c.sub), chain.now()]);
    if (nonce !== BigInt(a.ownerNonce)) {
      await db.update(ownerActions).set({ status: 'superseded', updatedAt: new Date() }).where(eq(ownerActions.id, id));
      throw new ApiError('OWNER_NONCE_STALE', { details: { signedNonce: a.ownerNonce, currentNonce: nonce.toString() } });
    }
    if (t > a.deadline) throw new ApiError('SIGNATURE_EXPIRED');
    await assertNoInflight(c.sub);
    const data =
      kind === 'updateTerms'
        ? encodeFunctionData({ abi: vouchAbi, functionName: 'updateTerms', args: [venue, message.rewardBps as number, message.minOrder as bigint, a.deadline, signature] })
        : kind === 'setKeys'
          ? encodeFunctionData({
              abi: vouchAbi,
              functionName: 'setKeys',
              args: [venue, message.payout as Address, message.signer as Address, message.attributor as Address, a.deadline, signature],
            })
          : encodeFunctionData({
              abi: vouchAbi,
              functionName: 'setSeedAmbassador',
              args: [venue, message.ambassador as Address, message.allowed as boolean, a.deadline, signature],
            });
    await db.update(ownerActions).set({ status: 'relaying', signature, updatedAt: new Date() }).where(eq(ownerActions.id, id));
    let handle;
    try {
      handle = await deps.relayer.submit({ kind: kind as RelayKind, data, user: c.sub, ref: `action:${id}` });
    } catch (e) {
      await db
        .update(ownerActions)
        .set({ status: 'failed', errorCode: e instanceof ApiError ? e.code : 'INTERNAL', updatedAt: new Date() })
        .where(eq(ownerActions.id, id));
      throw e;
    }
    await db.update(ownerActions).set({ relayTxId: handle.id, txHash: handle.hash, updatedAt: new Date() }).where(eq(ownerActions.id, id));
    deps.sse.publish(SseHub.venueChannel(venue), 'venue.action.pending', { venue, actionId: id, kind, txHash: handle.hash });
    void handle.done.then(async (o) => {
      await db
        .update(ownerActions)
        .set({
          status: o.status === 'mined' ? 'relayed' : 'failed',
          ...(o.status === 'failed' ? { errorCode: o.error.code } : { txHash: o.hash }),
          updatedAt: new Date(),
        })
        .where(eq(ownerActions.id, id));
      if (o.status !== 'mined') deps.sse.publish(SseHub.venueChannel(venue), 'venue.action.failed', { venue, actionId: id, kind });
    });
    return send(reply, 202, { actionId: id, kind, status: 'pending', txHash: handle.hash, relayId: handle.id });
  });

  app.get('/venues/:venue/actions/:id', async (req, reply) => {
    const c = await ctx.auth(req);
    const { id } = req.params as { venue: string; id: string };
    const [a] = await db.select().from(ownerActions).where(eq(ownerActions.id, id)).limit(1);
    if (!a || !sameAddr(a.owner, c.sub)) throw new ApiError('NOT_FOUND');
    return send(reply, 200, { actionId: a.id, kind: a.kind, status: a.status, txHash: a.txHash, errorCode: a.errorCode });
  });
}
