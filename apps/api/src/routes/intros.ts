/**
 * Intro links (personal / broadcast), link opens, and relayed acceptIntro.
 *   prepare  → the referrer gets an `Intro` with CHAIN-time issuedAt and the venue's CURRENT termsVersion (D-505)
 *   create   → the signed intro is stored under a short public code
 *   open     → an attribution signal (rate-limited, no auth needed)
 *   accept   → the customer countersigns `IntroAcceptance`; the relayer submits `acceptIntro`
 * Superseded terms (D-516): an intro on an old termsVersion stays acceptable until effectiveAt(next) + 72 h; the API
 * reports `reissueBy` before that and `needs_reissue` after it, so referrers are prompted to re-share (D-013(4)).
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { INTRO_ACCEPTANCE_TYPES, INTRO_TYPES, LINK_TYPE, VOUCH_LIMITS, introDigest, vouchAbi, type Intro } from '@vouch/shared';
import type { VouchReads } from '../chain/client';
import { introLinks, linkOpens, users, venuesMeta } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, hex, int, money, obj, oneOf, sameAddr, sig, str, uint } from '../http/json';
import { RateLimiter } from '../relayer/rate-limit';
import { SseHub } from '../sse/hub';
import { send, shortCode, typedDataJson, verifyTyped, randomHex32, type Ctx } from './common';

export const SUPERSEDED_GRACE = 72n * 3600n;
const DAY = 86_400n;
const ACCEPT_WINDOW = 900n;

export type LinkRow = typeof introLinks.$inferSelect;

export function linkToIntro(l: LinkRow): Intro {
  return {
    venue: getAddress(l.venue),
    referrer: getAddress(l.referrer),
    termsVersion: l.termsVersion,
    linkType: l.linkType,
    issuedAt: l.issuedAt,
    expiresAt: l.expiresAt,
    nonce: l.nonce as Hex,
  };
}

export async function linkStatus(chain: VouchReads, l: LinkRow, now: bigint): Promise<{ status: 'active' | 'expired' | 'needs_reissue'; reissueBy: bigint | null; currentTermsVersion: number }> {
  const cur = await chain.currentTerms(getAddress(l.venue));
  if (now > l.expiresAt) return { status: 'expired', reissueBy: null, currentTermsVersion: cur.version };
  if (l.termsVersion < cur.version) {
    const next = await chain.getTerms(getAddress(l.venue), l.termsVersion + 1);
    const graceEnd = next.effectiveAt + SUPERSEDED_GRACE;
    return { status: now > graceEnd ? 'needs_reissue' : 'active', reissueBy: graceEnd, currentTermsVersion: cur.version };
  }
  return { status: 'active', reissueBy: null, currentTermsVersion: cur.version };
}

export function registerIntroRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps, domain } = ctx;
  const db = deps.handle.db;
  const chain = deps.chain;
  const openLimit = new RateLimiter(10);

  async function getLink(code: string): Promise<LinkRow> {
    if (!/^[0-9A-Za-z]{4,32}$/.test(code)) throw new ApiError('NOT_FOUND');
    const [l] = await db.select().from(introLinks).where(eq(introLinks.code, code)).limit(1);
    if (!l) throw new ApiError('NOT_FOUND');
    return l;
  }

  app.post('/intros/prepare', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const venue = addr(b.venue, 'venue');
    const linkType = oneOf(b.linkType, 'linkType', ['personal', 'broadcast'] as const) === 'personal' ? LINK_TYPE.PERSONAL : LINK_TYPE.BROADCAST;
    const ttlDays = b.ttlDays === undefined ? (linkType === LINK_TYPE.PERSONAL ? 7 : 14) : int(b.ttlDays, 'ttlDays', 1, 30);
    const v = await chain.getVenue(venue);
    if (v.owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');
    if (!(await chain.canRefer(venue, c.sub))) throw new ApiError('REFERRER_NOT_ELIGIBLE');
    const [terms, t] = await Promise.all([chain.currentTerms(venue), chain.now()]);
    const ttl = BigInt(ttlDays) * DAY;
    const intro: Intro = {
      venue,
      referrer: c.sub,
      termsVersion: terms.version,
      linkType,
      issuedAt: t,
      expiresAt: t + (ttl > BigInt(VOUCH_LIMITS.MAX_INTRO_TTL_SECONDS) ? BigInt(VOUCH_LIMITS.MAX_INTRO_TTL_SECONDS) : ttl),
      nonce: randomHex32(),
    };
    return send(reply, 200, { intro, typedData: typedDataJson(domain, INTRO_TYPES, 'Intro', { ...intro }) });
  });

  app.post('/intros', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const i = obj(b.intro, 'intro');
    const intro: Intro = {
      venue: addr(i.venue, 'intro.venue'),
      referrer: addr(i.referrer, 'intro.referrer'),
      termsVersion: int(i.termsVersion, 'intro.termsVersion', 1, 2 ** 32 - 1),
      linkType: int(i.linkType, 'intro.linkType', 0, 1),
      issuedAt: uint(i.issuedAt, 'intro.issuedAt'),
      expiresAt: uint(i.expiresAt, 'intro.expiresAt'),
      nonce: hex(i.nonce, 'intro.nonce', 32),
    };
    const signature = sig(b.signature);
    if (!sameAddr(intro.referrer, c.sub)) throw new ApiError('FORBIDDEN');
    // Validate at create time (SEC-2-11): a known venue and a referrer who may refer there.
    if ((await chain.getVenue(intro.venue)).owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');
    if (!(await chain.canRefer(intro.venue, c.sub))) throw new ApiError('REFERRER_NOT_ELIGIBLE');
    const window = intro.expiresAt - intro.issuedAt;
    if (window <= 0n || window > BigInt(VOUCH_LIMITS.MAX_INTRO_TTL_SECONDS)) throw new ApiError('BAD_REQUEST', { message: 'Link lifetime must be 1 second to 30 days.' });
    await verifyTyped(c.sub, domain, INTRO_TYPES, 'Intro', { ...intro }, signature);
    const introHash = introDigest(domain, intro);
    const [dupe] = await db.select({ code: introLinks.code }).from(introLinks).where(eq(introLinks.introHash, introHash)).limit(1);
    if (dupe) return send(reply, 200, { code: dupe.code, url: `${deps.cfg.publicWebUrl}/i/${dupe.code}`, introHash });
    const code = shortCode();
    await db.insert(introLinks).values({
      code,
      venue: intro.venue,
      referrer: intro.referrer,
      linkType: intro.linkType,
      termsVersion: intro.termsVersion,
      issuedAt: intro.issuedAt,
      expiresAt: intro.expiresAt,
      nonce: intro.nonce,
      signature,
      introHash,
      note: str(b.note, 'note', 140, { optional: true }) ?? null,
    });
    return send(reply, 201, { code, url: `${deps.cfg.publicWebUrl}/i/${code}`, introHash, linkType: intro.linkType === 0 ? 'personal' : 'broadcast', expiresAt: intro.expiresAt });
  });

  app.get('/intros/:code', async (req, reply) => {
    const l = await getLink((req.params as { code: string }).code);
    const [t, ref, meta] = await Promise.all([
      chain.now(),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.address, l.referrer)).limit(1),
      db.select({ name: venuesMeta.name }).from(venuesMeta).where(eq(venuesMeta.venue, l.venue)).limit(1),
    ]);
    const st = await linkStatus(chain, l, t);
    const terms = await chain.getTerms(getAddress(l.venue), l.termsVersion);
    return send(reply, 200, {
      code: l.code,
      venue: { venue: l.venue, name: meta[0]?.name ?? null },
      referrer: { address: l.referrer, displayName: ref[0]?.displayName ?? null },
      linkType: l.linkType === 0 ? 'personal' : 'broadcast',
      termsVersion: l.termsVersion,
      terms: { rewardBps: terms.rewardBps, minOrder: money(terms.minOrder) },
      issuedAt: l.issuedAt,
      expiresAt: l.expiresAt,
      introHash: l.introHash,
      ...st,
    });
  });

  app.post('/intros/:code/opens', async (req, reply) => {
    const l = await getLink((req.params as { code: string }).code);
    const c = await ctx.optionalAuth(req);
    const key = `${ctx.ipKey(req)}:${l.code}`;
    if (!openLimit.take(key)) return send(reply, 202, { recorded: false, reason: 'rate_limited' });
    // The referrer opening their own link is not a signal.
    if (c && sameAddr(c.sub, l.referrer)) return send(reply, 202, { recorded: false, reason: 'own_link' });
    await db.insert(linkOpens).values({ code: l.code, opener: c?.sub ?? null, ipHash: ctx.ipKey(req), userAgent: req.headers['user-agent']?.slice(0, 200) ?? null });
    // D-807: logged-out opens are kept for analytics but never feed the attribution weights.
    return send(reply, 201, { recorded: true, countsForAttribution: !!c });
  });

  async function precheckAccept(l: LinkRow, customer: Address) {
    const venue = getAddress(l.venue);
    if (sameAddr(customer, l.referrer)) throw new ApiError('SELF_REFERRAL');
    const [t, cust, used] = await Promise.all([chain.now(), chain.getCustomer(venue, customer), chain.isIntroUsed(l.introHash as Hex, customer, l.linkType)]);
    if (cust.verified) throw new ApiError('ALREADY_REWARDED');
    if (used) throw new ApiError('INTRO_ALREADY_USED');
    const st = await linkStatus(chain, l, t);
    if (st.status === 'expired') throw new ApiError('INTRO_EXPIRED');
    if (st.status === 'needs_reissue') throw new ApiError('LINK_NEEDS_REISSUE');
    return t;
  }

  app.post('/intros/:code/accept/prepare', async (req, reply) => {
    const c = await ctx.auth(req);
    const l = await getLink((req.params as { code: string }).code);
    const t = await precheckAccept(l, c.sub);
    const acceptance = { introHash: l.introHash as Hex, customer: c.sub, deadline: t + ACCEPT_WINDOW };
    return send(reply, 200, { acceptance, typedData: typedDataJson(domain, INTRO_ACCEPTANCE_TYPES, 'IntroAcceptance', acceptance) });
  });

  app.post('/intros/:code/accept', async (req, reply) => {
    const c = await ctx.auth(req);
    const l = await getLink((req.params as { code: string }).code);
    const b = obj(req.body);
    const a = obj(b.acceptance, 'acceptance');
    const acceptance = { introHash: l.introHash as Hex, customer: c.sub, deadline: uint(a.deadline, 'acceptance.deadline') };
    const signature = sig(b.signature);
    await verifyTyped(c.sub, domain, INTRO_ACCEPTANCE_TYPES, 'IntroAcceptance', acceptance, signature);
    const t = await precheckAccept(l, c.sub);
    if (t > acceptance.deadline) throw new ApiError('SIGNATURE_EXPIRED');
    const intro = linkToIntro(l);
    const data = encodeFunctionData({ abi: vouchAbi, functionName: 'acceptIntro', args: [intro, l.signature as Hex, acceptance, signature] });
    const handle = await deps.relayer.submit({ kind: 'acceptIntro', data, user: c.sub, venue: l.venue, ref: `intro:${l.code}:${c.sub}` });
    const evt = { code: l.code, venue: l.venue, referrer: l.referrer, customer: c.sub, introHash: l.introHash, txHash: handle.hash, relayId: handle.id };
    deps.sse.publish(SseHub.userChannel(c.sub), 'intro.pending', evt);
    deps.sse.publish(SseHub.userChannel(l.referrer), 'intro.pending', evt);
    void handle.done.then((o) => {
      if (o.status !== 'mined') deps.sse.publish(SseHub.userChannel(c.sub), 'intro.failed', { ...evt, code: l.code, error: o.status === 'failed' ? o.error.code : 'TX_FAILED' });
    });
    return send(reply, 202, { status: 'pending', txHash: handle.hash, relayId: handle.id, introHash: l.introHash });
  });

  /** The referrer's own links, with re-issue prompts after a terms change. */
  app.get('/me/links', async (req, reply) => {
    const c = await ctx.auth(req);
    const rows = await db.select().from(introLinks).where(eq(introLinks.referrer, c.sub)).orderBy(desc(introLinks.createdAt)).limit(100);
    const t = await chain.now();
    const out = await Promise.all(
      rows.map(async (l) => {
        const opens = await db.select({ id: linkOpens.id }).from(linkOpens).where(eq(linkOpens.code, l.code));
        return {
          code: l.code,
          url: `${deps.cfg.publicWebUrl}/i/${l.code}`,
          venue: l.venue,
          linkType: l.linkType === 0 ? 'personal' : 'broadcast',
          termsVersion: l.termsVersion,
          expiresAt: l.expiresAt,
          opens: opens.length,
          ...(await linkStatus(chain, l, t)),
        };
      }),
    );
    return send(reply, 200, { links: out });
  });
}

/**
 * Opens of the link carrying `introHash` that count for attribution (D-807, SEC-2-05): only opens made by the paying
 * customer's own signed-in session. Anonymous opens (and the referrer's own) are recorded but never scored.
 */
export async function opensFor(ctx: Ctx, introHash: Hex, customer: Address): Promise<number> {
  const db = ctx.deps.handle.db;
  const [l] = await db.select({ code: introLinks.code, referrer: introLinks.referrer }).from(introLinks).where(eq(introLinks.introHash, introHash)).limit(1);
  if (!l || sameAddr(l.referrer, customer)) return 0;
  const rows = await db.select({ id: linkOpens.id }).from(linkOpens).where(and(eq(linkOpens.code, l.code), eq(linkOpens.opener, customer)));
  return rows.length;
}
