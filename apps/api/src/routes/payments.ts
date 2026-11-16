/**
 * Quote + relayed pay.
 *
 * Quote: load the venue-signed order → baseline attribution over the customer's LIVE on-chain intros (+ link opens,
 * + "Who sent you here?") → Weights signed by ATTRIBUTOR (only when the venue's attributor is our key) →
 * previewPayment (the exact code path pay uses) → PaymentAuth{…, submitter = RELAYER} (D-014/D-519: never 0) → the USDC
 * ReceiveWithAuthorization typed data the customer signs (nonce = hashStruct(PaymentAuth), D-103).
 *
 * Pay: verify the customer's signature off-chain, QE-C-11 balance ≥ amount, simulate; OrderAlreadySettled is TERMINAL
 * (QE-C-10: the customer may have settled the order with a self-submit auth) and the real split is read from Streams,
 * never from the quote. Otherwise relay; the response and SSE say "pending"; "settled" only ever comes from Streams.
 *
 * `mode: "self-submit"` (kill-the-backend helper/CLI only) returns an auth with submitter = the customer plus the
 * QE-C-11 fee pre-flight; the API never relays those.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { encodeFunctionData, getAddress, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import {
  ARC_TESTNET_USDC_EIP712_DOMAIN,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  WEIGHTS_MODE,
  receiveAuthForPayment,
  vouchAbi,
  weightsStructHash,
  type Order,
  type PaymentAuth,
  type Weights,
} from '@vouch/shared';
import type { AttributionCandidate } from '../attribution/baseline';
import type { QuoteView } from '../chain/client';
import { orders, paymentIntents } from '../db/schema';
import { ApiError } from '../http/errors';
import { addr, hex, money, obj, oneOf, optAddr, reqStr, sameAddr, sig, toJson } from '../http/json';
import { assertCanPayRelayed, assertCanSelfSubmit } from '../relayer/preflight';
import { SseHub } from '../sse/hub';
import { send, typedDataJson, verifyTyped, type Ctx } from './common';
import { opensFor } from './intros';
import { settledView } from './views';

export const AUTH_WINDOW = 600n;
/** Upper bound for a self-submitted pay() used to size the fee pre-flight (live canonical ≈ 371–410k; worst ≥ 805k). */
export const SELF_SUBMIT_GAS_BOUND = 900_000n;

const EMPTY_WEIGHTS: Weights = { venue: zeroAddress, customer: zeroAddress, orderId: zeroHash, referrers: [], bps: [] };

function quoteView(q: QuoteView) {
  const rewards = [
    ...(q.cashback > 0n ? [{ role: 'cashback', recipient: null, amount: money(q.cashback) }] : []),
    ...q.referrers.map((r, i) => ({ role: 'referrer', recipient: r, bps: q.bps[i], termsVersion: q.termsVersions[i], amount: money(q.l1Amounts[i] ?? 0n) })),
    ...q.l2Recipients.map((r, i) => ({ role: 'introducer', recipient: r === zeroAddress ? null : r, via: q.referrers[i], amount: money(q.l2Amounts[i] ?? 0n), returnsToVenue: r === zeroAddress })),
  ];
  return {
    amount: money(q.amount),
    cashback: money(q.cashback),
    venueAmount: money(q.venueAmount),
    rewardPool: money(q.rewardPool),
    firstPurchase: q.firstPurchase,
    rewarded: q.rewarded,
    weightsMode: q.weightsMode,
    introducer: q.introducer === zeroAddress ? null : q.introducer,
    rewards,
  };
}

export function registerPaymentRoutes(app: FastifyInstance, ctx: Ctx) {
  const { deps } = ctx;
  const db = deps.handle.db;
  const chain = deps.chain;

  async function loadOrder(venue: Address, orderId: Hex) {
    const [o] = await db.select().from(orders).where(and(eq(orders.venue, venue), eq(orders.orderId, orderId))).limit(1);
    if (!o) throw new ApiError('NOT_FOUND', { message: "We couldn't find that order. Ask the venue for a new code." });
    return o;
  }

  async function alreadyPaid(venue: Address, orderId: Hex, intentId?: string) {
    if (intentId) await db.update(paymentIntents).set({ status: 'already_settled', errorCode: 'ORDER_ALREADY_PAID', updatedAt: new Date() }).where(eq(paymentIntents.id, intentId));
    const settled = await deps.streams.getPayment(venue, orderId);
    return new ApiError('ORDER_ALREADY_PAID', {
      details: { venue, orderId, settled: settled ? toJson(settledView(settled)) : null, waitingOnStreams: !settled },
    });
  }

  app.post('/payments/quote', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const venue = addr(b.venue, 'venue');
    const orderId = hex(b.orderId, 'orderId', 32);
    const whoSentYou = optAddr(b.whoSentYou, 'whoSentYou') ?? null;
    const mode = b.mode === undefined ? 'relayed' : oneOf(b.mode, 'mode', ['relayed', 'self-submit'] as const);
    const o = await loadOrder(venue, orderId);
    const order: Order = { venue, orderId, amount: o.amount, expiresAt: o.expiresAt };
    const customer = c.sub;

    const [t, settledOnChain, cust, v] = await Promise.all([chain.now(), chain.isOrderSettled(venue, orderId), chain.getCustomer(venue, customer), chain.getVenue(venue)]);
    if (settledOnChain) throw await alreadyPaid(venue, orderId);
    if (t > order.expiresAt) throw new ApiError('ORDER_EXPIRED');
    if (v.owner === zeroAddress) throw new ApiError('UNKNOWN_VENUE');

    // ---- attribution (first purchase only)
    let weights = EMPTY_WEIGHTS;
    let weightsSig: Hex = '0x';
    let weightsHash: Hex = zeroHash;
    let attribution: Record<string, unknown> | null = null;
    const warnings: string[] = [];
    if (!cust.verified) {
      const live = await chain.getLiveIntros(venue, customer);
      const minOrders = new Map<number, bigint>();
      for (const li of live) if (!minOrders.has(li.termsVersion)) minOrders.set(li.termsVersion, (await chain.getTerms(venue, li.termsVersion)).minOrder);
      const candidates: AttributionCandidate[] = await Promise.all(
        live.map(async (li) => ({
          referrer: li.referrer,
          introHash: li.introHash,
          linkType: li.linkType,
          acceptedAt: li.acceptedAt,
          expiresAt: li.expiresAt,
          termsVersion: li.termsVersion,
          minOrder: minOrders.get(li.termsVersion)!,
          opens: await opensFor(ctx, li.introHash, customer),
        })),
      );
      const res = await deps.attributor.attribute({ venue, customer, orderId, amount: order.amount, now: t, candidates, whoSentYou });
      attribution = { method: res.method, explanation: res.explanation, referrers: res.referrers, bps: res.bps, scores: res.scores };
      if (live.length > 0 && res.referrers.length === 0) warnings.push('no_eligible_recommendation');
      if (live.length === 0) warnings.push('first_purchase_without_recommendation');
      if (res.referrers.length > 0) {
        if (deps.signers.attributor && sameAddr(v.attributor, deps.signers.attributor)) {
          weights = { venue, customer, orderId, referrers: res.referrers, bps: res.bps };
          weightsSig = await deps.signers.signWeights(weights);
          weightsHash = weightsStructHash(weights);
        } else {
          warnings.push('venue_attributor_not_managed_fallback_rule');
        }
      }
    }
    const quote = await chain.previewPayment(venue, customer, orderId, order.amount, weights, weightsSig, weightsHash);
    if (weightsHash !== zeroHash && quote.weightsMode !== WEIGHTS_MODE.ATTRIBUTOR) {
      deps.log('quote: signed weights not accepted by previewPayment; using the fallback rule', { weightsMode: quote.weightsMode });
      warnings.push('weights_fallback');
    }
    if (quote.firstPurchase && !quote.rewarded) warnings.push('first_purchase_not_rewarded');

    // ---- PaymentAuth: submitter is the RELAYER (app) or the customer (self-submit helper). Never 0 (D-014).
    let submitter: Address;
    if (mode === 'relayed') {
      if (!deps.relayer.address) throw new ApiError('RELAYER_DOWN');
      submitter = deps.relayer.address;
    } else submitter = customer;
    if (submitter === zeroAddress) throw new ApiError('INTERNAL', { details: { reason: 'refusing submitter = 0' } });
    const deadline = t + AUTH_WINDOW < order.expiresAt + 1n ? t + AUTH_WINDOW : order.expiresAt + 1n;
    const auth: PaymentAuth = { customer, venue, orderId, amount: order.amount, weightsHash, deadline, submitter };
    const rwa = receiveAuthForPayment(auth, chain.vouch);

    const balance = await chain.usdcBalance(customer);
    let selfSubmit: Record<string, unknown> | undefined;
    if (mode === 'self-submit') {
      const fees = await chain.fees();
      const pre = await assertCanSelfSubmit(chain, customer, order.amount, SELF_SUBMIT_GAS_BOUND, fees.maxFeePerGas);
      selfSubmit = { gasLimitBound: SELF_SUBMIT_GAS_BOUND, maxFeePerGas: fees.maxFeePerGas, needed: money(pre.needed), note: 'the customer EOA sends pay(); re-check with the real estimate before sending' };
    } else if (balance < order.amount) warnings.push('insufficient_balance');

    const id = crypto.randomUUID();
    await db.insert(paymentIntents).values({
      id,
      venue,
      orderId,
      customer,
      amount: order.amount,
      quote: toJson(quote),
      weights: toJson(weights),
      weightsSig,
      weightsHash,
      attribution: attribution ? toJson(attribution) : null,
      auth: toJson(auth),
      submitter,
      deadline,
    });
    return send(reply, 200, {
      intentId: id,
      mode,
      order,
      orderSignature: o.signature,
      quote: quoteView(quote),
      attribution,
      weights,
      weightsSignature: weightsSig,
      paymentAuth: auth,
      typedData: typedDataJson(ARC_TESTNET_USDC_EIP712_DOMAIN, RECEIVE_WITH_AUTHORIZATION_TYPES, 'ReceiveWithAuthorization', { ...rwa }),
      balance: money(balance),
      canAfford: balance >= order.amount,
      warnings,
      ...(selfSubmit ? { selfSubmit } : {}),
    });
  });

  app.post('/payments', async (req, reply) => {
    const c = await ctx.auth(req);
    const b = obj(req.body);
    const intentId = reqStr(b.intentId, 'intentId', 64);
    const signature = sig(b.signature);
    const [it] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    if (!it || !sameAddr(it.customer, c.sub)) throw new ApiError('NOT_FOUND');
    if (it.status !== 'quoted') throw new ApiError(it.status === 'already_settled' ? 'ORDER_ALREADY_PAID' : 'PAYMENT_ALREADY_USED', { details: { status: it.status } });
    if (!deps.relayer.address) throw new ApiError('RELAYER_DOWN');
    if (!sameAddr(it.submitter, deps.relayer.address)) throw new ApiError('BAD_REQUEST', { message: 'This payment is sent from your own account, not by Vouch.' });
    const venue = getAddress(it.venue);
    const orderId = it.orderId as Hex;
    const a = it.auth as Record<string, string>;
    const auth: PaymentAuth = {
      customer: getAddress(a.customer!),
      venue,
      orderId,
      amount: BigInt(a.amount!),
      weightsHash: a.weightsHash as Hex,
      deadline: BigInt(a.deadline!),
      submitter: getAddress(a.submitter!),
    };
    const w = it.weights as { venue: string; customer: string; orderId: string; referrers: string[]; bps: number[] };
    const weights: Weights = { venue: getAddress(w.venue), customer: getAddress(w.customer), orderId: w.orderId as Hex, referrers: w.referrers.map((x) => getAddress(x)), bps: w.bps };
    const rwa = receiveAuthForPayment(auth, chain.vouch);
    await verifyTyped(c.sub, ARC_TESTNET_USDC_EIP712_DOMAIN, RECEIVE_WITH_AUTHORIZATION_TYPES, 'ReceiveWithAuthorization', { ...rwa }, signature);
    const t = await chain.now();
    if (t >= auth.deadline) throw new ApiError('PAYMENT_EXPIRED');
    // QE-C-11 (relayed): balance ≥ amount, before anything is sent.
    await assertCanPayRelayed(chain, c.sub, auth.amount);
    const o = await loadOrder(venue, orderId);
    const order: Order = { venue, orderId, amount: o.amount, expiresAt: o.expiresAt };
    const data = encodeFunctionData({ abi: vouchAbi, functionName: 'pay', args: [order, o.signature as Hex, weights, it.weightsSig as Hex, auth, signature] });

    // Fast pre-simulation (the relayer simulates again inside its lock). QE-C-10: OrderAlreadySettled is terminal.
    const sim = await chain.simulate(data).catch(() => null);
    if (sim && !sim.ok && sim.revert.name === 'OrderAlreadySettled') throw await alreadyPaid(venue, orderId, intentId);

    await db.update(paymentIntents).set({ status: 'relaying', updatedAt: new Date() }).where(eq(paymentIntents.id, intentId));
    let handle;
    try {
      handle = await deps.relayer.submit({
        kind: 'pay',
        data,
        user: c.sub,
        ref: `intent:${intentId}`,
        preflight: async () => {
          await assertCanPayRelayed(chain, c.sub, auth.amount);
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORDER_ALREADY_PAID') throw await alreadyPaid(venue, orderId, intentId);
      await db
        .update(paymentIntents)
        .set({ status: 'failed', errorCode: e instanceof ApiError ? e.code : 'INTERNAL', updatedAt: new Date() })
        .where(eq(paymentIntents.id, intentId));
      if (e instanceof ApiError && !['RATE_LIMITED', 'RELAYER_BUSY'].includes(e.code)) await db.update(orders).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(orders.venue, venue), eq(orders.orderId, orderId)));
      // A rate-limited / busy attempt can be retried with the same intent.
      if (e instanceof ApiError && ['RATE_LIMITED', 'RELAYER_BUSY'].includes(e.code)) await db.update(paymentIntents).set({ status: 'quoted', errorCode: null }).where(eq(paymentIntents.id, intentId));
      throw e;
    }
    await db.update(paymentIntents).set({ relayTxId: handle.id, txHash: handle.hash, updatedAt: new Date() }).where(eq(paymentIntents.id, intentId));
    const evt = { intentId, venue, orderId, customer: c.sub, amount: money(auth.amount), txHash: handle.hash, status: 'pending' };
    deps.sse.publish(SseHub.userChannel(c.sub), 'payment.pending', evt);
    deps.sse.publish(SseHub.venueChannel(venue), 'payment.pending', evt);
    void handle.done.then(async (out) => {
      let status: 'relayed' | 'failed' | 'already_settled' = out.status === 'mined' ? 'relayed' : 'failed';
      let errorCode: string | null = out.status === 'failed' ? out.error.code : out.status === 'reverted' ? 'TX_FAILED' : null;
      if (out.status !== 'mined' && (await chain.isOrderSettled(venue, orderId).catch(() => false))) {
        status = 'already_settled'; // QE-C-10: settled by another auth; the split comes from Streams
        errorCode = 'ORDER_ALREADY_PAID';
      }
      await db.update(paymentIntents).set({ status, errorCode, ...(out.status !== 'failed' ? { txHash: out.hash } : {}), updatedAt: new Date() }).where(eq(paymentIntents.id, intentId));
      await db
        .update(orders)
        .set({ status: status === 'relayed' ? 'relayed' : status === 'failed' ? 'failed' : 'relayed', ...(out.status !== 'failed' ? { txHash: out.hash } : {}), updatedAt: new Date() })
        .where(and(eq(orders.venue, venue), eq(orders.orderId, orderId)));
      if (status !== 'relayed') {
        const fe = { ...evt, status, code: errorCode };
        deps.sse.publish(SseHub.userChannel(c.sub), 'payment.failed', fe);
        deps.sse.publish(SseHub.venueChannel(venue), 'payment.failed', fe);
      }
    });
    return send(reply, 202, { intentId, status: 'pending', txHash: handle.hash, relayId: handle.id });
  });

  app.get('/payments/:intentId', async (req, reply) => {
    const c = await ctx.auth(req);
    const [it] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, (req.params as { intentId: string }).intentId)).limit(1);
    if (!it || !sameAddr(it.customer, c.sub)) throw new ApiError('NOT_FOUND');
    const settled = await deps.streams.getPayment(getAddress(it.venue), it.orderId as Hex);
    return send(reply, 200, {
      intentId: it.id,
      venue: it.venue,
      orderId: it.orderId,
      amount: money(it.amount),
      relayStatus: it.status,
      txHash: it.txHash,
      errorCode: it.errorCode,
      // "settled" comes only from Streams-derived state (QE-C-10: never from the quote).
      status: settled ? 'settled' : it.status === 'failed' ? 'failed' : 'pending',
      settled: settled ? settledView(settled) : null,
      waitingOnStreams: !settled && (it.status === 'relayed' || it.status === 'already_settled'),
    });
  });
}
