/**
 * Typed client for the hosted Vouch API (INTERFACES §5; shapes taken from apps/api/src/routes/*). bigint fields arrive
 * as decimal strings; money as {baseUnits, display}. Errors are {error:{code,message,retryable,details}} → ApiError.
 * Auth is `Authorization: Bearer` only; `?token=` is used ONLY for the user SSE stream (see lib/sse.ts).
 */
import type { Address, Hex } from "viem";
import { API_URL } from "./config";
import { getSession, setSession } from "@/state/session";
import type { TypedDataJson } from "./sign";

export type U = string;
export interface Money {
  baseUnits: string;
  display: string;
}
export const money = (m: Money | null | undefined): bigint => (m ? BigInt(m.baseUnits) : 0n);

// ------------------------------------------------------------------------------------------------ errors
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable: boolean,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Friendly copy per code (COPY.md: say what happened + what to do next, reassure about money). The API's own
 * `message` is already primary-screen safe (D-806); these override it where the app knows more context.
 */
const FRIENDLY: Record<string, string> = {
  ORDER_EXPIRED: "This code has expired. Ask for a new one at the counter. Nothing was charged.",
  ORDER_ALREADY_PAID: "This order has already been paid. Nothing more was charged.",
  PAYMENT_EXPIRED: "That took a little too long. Nothing was charged. Try again.",
  PAYMENT_ALREADY_USED: "This payment was already sent. Nothing more was charged.",
  INSUFFICIENT_BALANCE: "Your balance is too low for this payment. Nothing was charged.",
  RELAYER_DOWN: "Payments are paused for a moment. Nothing was charged. Try again in a minute.",
  RELAYER_BUSY: "We're a little busy. Nothing was charged. Try again in a few seconds.",
  RELAYER_UNDERFUNDED: "Payments are paused for a moment. Nothing was charged. Try again later.",
  RELAYER_BUDGET_EXHAUSTED: "The demo has reached its limit for now. Nothing was charged. Try again later.",
  SPEND_QUOTA_EXCEEDED: "You've done a lot in a short time. Nothing was charged. Try again in a little while.",
  RATE_LIMITED: "Too many tries in a row. Wait a few seconds and try again.",
  TOPUP_ALREADY_CLAIMED: "You've already had your demo top-up on this account.",
  TOPUP_DAILY_CAP_REACHED: "Demo top-ups are used up for today. Ask the host to add money.",
  TOPUP_DISABLED: "Demo top-ups are switched off right now. Ask the host to add money.",
  ALREADY_REWARDED: "You've already made your first purchase here, so this one is a regular payment.",
  LINK_NEEDS_REISSUE: "This recommendation is out of date. Ask your friend for a new link.",
  INTRO_EXPIRED: "This recommendation has expired. Ask your friend for a new link.",
  INTRO_ALREADY_USED: "This personal recommendation was already used. Ask your friend for a new link.",
  SELF_REFERRAL: "That's your own recommendation. Share it with a friend instead.",
  REFERRER_NOT_ELIGIBLE: "You can recommend a place after your first purchase there.",
  UNKNOWN_VENUE: "We couldn't find this place.",
  VENUE_NOT_MANAGED: "This place can't take payments through Kudos right now.",
  TX_FAILED: "That didn't go through. Nothing was charged. Try again.",
  INVALID_SIGNATURE: "We couldn't confirm that. Nothing was charged. Try again.",
  SIGNATURE_EXPIRED: "That took a little too long. Try again.",
  OWNER_ACTION_PENDING: "We're still saving your last change. Try again in a moment.",
  OWNER_NONCE_STALE: "Something changed in the meantime. Try again.",
  UNAUTHENTICATED: "Please sign in again.",
  TOO_MANY_CONNECTIONS: "Live updates are busy. We'll keep checking.",
  NETWORK: "We can't reach Kudos right now. Check your connection and try again.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return FRIENDLY[e.code] ?? e.message ?? "Something went wrong. Try again.";
  const name = (e as Error)?.name;
  if (name === "WalletError" || name === "UnsafeSignatureError") return (e as Error).message;
  return "Something went wrong. Try again.";
}

// ------------------------------------------------------------------------------------------------ transport
type Method = "GET" | "POST" | "PATCH";
async function request<T>(method: Method, path: string, body?: unknown, opts: { auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const s = getSession();
  if (opts.auth !== false && s) headers.authorization = `Bearer ${s.token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.signal, cache: "no-store" });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", FRIENDLY.NETWORK, true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } })?.error;
    if (res.status === 401 && s) setSession(null);
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? "Something went wrong. Try again.", err?.retryable ?? res.status >= 500, err?.details);
  }
  return json as T;
}
const get = <T,>(p: string, o?: { auth?: boolean; signal?: AbortSignal }) => request<T>("GET", p, undefined, o);
const post = <T,>(p: string, b: unknown = {}, o?: { auth?: boolean }) => request<T>("POST", p, b, o);

// ------------------------------------------------------------------------------------------------ shapes
export interface SettledLine {
  role: "cashback" | "referrer" | "introducer";
  roleId: 0 | 1 | 2;
  recipient: Address;
  amount: Money;
  viaReferrer: Address;
  returned: boolean;
  returnReason: 0 | 1 | 2 | null;
  orderId: Hex;
  venue: Address;
  customer: Address;
  txHash: Hex;
  blockNumber: U;
  blockTime: number | null;
}
export interface Settled {
  source: "streams";
  venue: Address;
  customer: Address;
  orderId: Hex;
  amount: Money;
  venueAmount: Money;
  rewardPool: Money;
  firstPurchase: boolean;
  rewarded: boolean;
  weightsMode: number;
  txHash: Hex;
  blockNumber: U;
  blockTime: number | null;
  lines: SettledLine[];
}
export interface OrderStruct {
  venue: Address;
  orderId: Hex;
  amount: U;
  expiresAt: U;
}
export interface VenueTermsView {
  termsVersion: number | null;
  rewardBps: number;
  minOrder: Money;
  effectiveAt: U | null;
}
export interface VenueView {
  venue: Address;
  name: string | null;
  slug: string | null;
  description: string | null;
  owner: Address | null;
  status: "registered" | "prepared" | "relaying" | "failed" | "unknown";
  managedByVouch: boolean;
  terms: VenueTermsView | null;
  waitingOnStreams: boolean;
  txHash: string | null;
}
export interface MoneyEdge {
  orderId: Hex;
  from: Address;
  to: Address;
  role: 0 | 1 | 2;
  amount: Money;
  txHash: Hex;
  /** D-811 (after deploy): same as role; display names when known. */
  level?: 0 | 1 | 2;
  fromDisplayName?: string | null;
  toDisplayName?: string | null;
}
export interface VenueStats {
  venue: Address;
  verifiedCustomers: number;
  rewardedPurchases: number;
  payments: number;
  gross: Money;
  rewardsPaid: Money;
  rewardsReturned: Money;
  costPerVerifiedCustomer: Money | null;
  venueReceived?: Money;
  byRole?: { cashback: Money; referrer: Money; introducer: Money };
  edges: MoneyEdge[];
}
export type QuoteReward =
  | { role: "cashback"; recipient: null; amount: Money }
  | { role: "referrer"; recipient: Address; bps: number; termsVersion: number; amount: Money }
  | { role: "introducer"; recipient: Address | null; via: Address; amount: Money; returnsToVenue: boolean };
export interface QuoteRes {
  intentId: string;
  mode: "relayed" | "self-submit";
  order: OrderStruct;
  quote: {
    amount: Money;
    cashback: Money;
    venueAmount: Money;
    rewardPool: Money;
    firstPurchase: boolean;
    rewarded: boolean;
    weightsMode: number;
    introducer: Address | null;
    rewards: QuoteReward[];
  };
  attribution: {
    method: string;
    explanation: string;
    referrers: Address[];
    bps: number[];
    scores: { referrer: Address; eligible: boolean; reason?: string; score: number; opens: number; linkType: number }[];
  } | null;
  paymentAuth: Record<string, string>;
  typedData: TypedDataJson;
  balance: Money;
  canAfford: boolean;
  warnings: string[];
}
export interface IntentRes {
  intentId: string;
  venue: string;
  orderId: string;
  amount: Money;
  relayStatus: "quoted" | "relaying" | "relayed" | "failed" | "already_settled";
  txHash: string | null;
  errorCode: string | null;
  status: "settled" | "failed" | "pending";
  settled: Settled | null;
  waitingOnStreams: boolean;
}
export interface OrderPublic {
  order: OrderStruct;
  amount: Money;
  venueName: string | null;
  status: "paid" | "expired" | "pending" | "relayed" | "failed";
  relayStatus: string;
  txHash: string | null;
  paid: boolean;
  settled: Settled | null;
  waitingOnStreams: boolean;
}
export interface CreateOrderRes {
  order: OrderStruct;
  amount: Money;
  expiresAt: U;
  qrPayload: string;
  status: "pending";
}
export interface IntroStruct {
  venue: Address;
  referrer: Address;
  termsVersion: number;
  linkType: 0 | 1;
  issuedAt: U;
  expiresAt: U;
  nonce: Hex;
}
export interface LinkStatus {
  status: "active" | "expired" | "needs_reissue";
  reissueBy: U | null;
  currentTermsVersion: number;
}
export interface IntroGet extends LinkStatus {
  code: string;
  venue: { venue: string; name: string | null };
  referrer: { address: string; displayName: string | null };
  linkType: "personal" | "broadcast";
  termsVersion: number;
  terms: { rewardBps: number; minOrder: Money };
  issuedAt: U;
  expiresAt: U;
  introHash: Hex;
}
export interface MyLink extends LinkStatus {
  code: string;
  url: string;
  venue: string;
  linkType: "personal" | "broadcast";
  termsVersion: number;
  expiresAt: U;
  opens: number;
}
export interface IntroAcceptedJson {
  venue: Address;
  referrer: Address;
  customer: Address;
  introHash: Hex;
  termsVersion: number;
  linkType: number;
  expiresAt: U;
  txHash: Hex;
  blockTime: number | null;
  live: boolean;
}
export type ActivityItemJson =
  | { kind: "payment"; status: "pending"; intentId: string; venue: string; orderId: string; amount: Money; txHash: string | null }
  | { kind: "payment"; status: "settled"; blockNumber: U; blockTime: number | null; payment: Settled }
  | { kind: "reward"; status: "settled"; blockNumber: U; blockTime: number | null; reward: SettledLine }
  | { kind: "intro_received" | "intro_sent"; status: "settled"; blockNumber: U; blockTime: number | null; intro: IntroAcceptedJson };
export interface WalletRes {
  address: Address;
  balance: Money;
  rewardsEarned: Money;
  pending: { intentId: string; venue: string; orderId: string; amount: Money; txHash: string | null; status: "pending" }[];
}
export interface AmbassadorRes {
  address: Address;
  displayName: string | null;
  customersCredited: number;
  venues: { venue: Address; name: string | null }[];
  earned: { referrer: Money; introducer: Money; cashback: Money; total: Money };
  linksShared: number;
  recent: SettledLine[];
}
export interface RelayRes {
  id: string;
  kind: string;
  status: "queued" | "sent" | "mined" | "reverted" | "failed";
  txHash: string | null;
  errorCode: string | null;
}
export interface RelayerStatus {
  enabled: boolean;
  address: Address | null;
  balance: string | null;
  reachable: boolean | null;
  lowBalance: boolean | null;
  budget: { hourly: { remaining: Money }; daily: { remaining: Money } };
}
export interface SessionInfo {
  address: Address;
  displayName: string | null;
  expiresAt: string;
  roles: { customer: true; venueOwner: boolean };
  venues: { venue: Address; name: string; status: "prepared" | "relaying" | "registered" | "failed" }[];
}
/** Demo top-up (BACKEND_RELAYER D-811, MSG-088). 404 until deployed → feature-detected. */
export interface DemoTopupAttempt {
  status: "claimed" | "pending" | "confirmed" | "failed" | "unknown";
  amount: Money;
  txHash: string | null;
  relayId: string | null;
  errorCode: string | null;
  claimedAt: string | null;
}
export interface DemoTopupStatus {
  enabled: boolean;
  eligible: boolean;
  amount: Money;
  dailyRemaining: Money;
  reason?: "TOPUP_DISABLED" | "UNAUTHENTICATED" | "TOPUP_ALREADY_CLAIMED" | "TOPUP_DAILY_CAP_REACHED";
  topup: DemoTopupAttempt | null;
}
export interface DemoTopupRes {
  status: "pending";
  amount: Money;
  txHash: string | null;
  relayId: string | null;
}
/** Venue feed history (D-811, MSG-088), newest first. */
export interface FeedPerson {
  address: Address;
  displayName: string | null;
}
export interface VenuePayment {
  orderId: Hex;
  txHash: Hex;
  blockNumber: U;
  settledAt: string | null;
  customer: FeedPerson;
  amount: Money;
  venueReceived: Money;
  cashback: Money;
  rewards: { recipient: FeedPerson; level: 1 | 2; amount: Money }[];
  rewardsReturned: Money;
  firstPurchase: boolean;
  rewarded: boolean;
}
export interface VenuePaymentsRes {
  venue: Address;
  payments: VenuePayment[];
  nextBefore: string | null;
}

// ------------------------------------------------------------------------------------------------ endpoints
export const api = {
  health: () => get<{ ok: boolean }>("/health", { auth: false }),
  relayerStatus: () => get<RelayerStatus>("/relayer/status", { auth: false }),

  challenge: (address: Address) => post<{ challengeId: string; message: string; expiresAt: string }>("/auth/challenge", { address }, { auth: false }),
  verify: (b: { address: Address; challengeId: string; signature: Hex; displayName?: string; passkeyCredentialId?: string }) =>
    post<{ token: string; expiresAt: string; user: { address: Address; displayName: string | null } }>("/auth/verify", b, { auth: false }),
  session: () => get<SessionInfo>("/auth/session"),
  logout: () => post<{ ok: true }>("/auth/logout"),

  venuePrepare: (b: { name: string; rewardBps: number; minOrder: string; description?: string }) =>
    post<{ venue: Address; slug: string; typedData: TypedDataJson }>("/venues/prepare", b),
  venueSubmit: (b: { venue: Address; signature: Hex }) => post<{ venue: Address; status: "pending"; txHash: Hex; relayId: string }>("/venues", b),
  venue: (v: string) => get<VenueView>(`/venues/${v}`, { auth: false }),
  venueStats: (v: string) => get<VenueStats>(`/venues/${v}/stats`, { auth: false }),
  venuePayments: (v: string, limit = 20) => get<VenuePaymentsRes>(`/venues/${v}/payments?limit=${limit}`, { auth: false }),

  createOrder: (v: string, b: { amount: string; ttlSeconds?: number; label?: string }) => post<CreateOrderRes>(`/venues/${v}/orders`, b),
  ownerOrders: (v: string) =>
    get<{ venue: Address; orders: { orderId: Hex; amount: Money; expiresAt: U; label: string | null; status: string; txHash: string | null; paid: boolean; settled: Settled | null }[] }>(`/venues/${v}/orders`),
  order: (v: string, o: string, signal?: AbortSignal) => get<OrderPublic>(`/venues/${v}/orders/${o}`, { auth: false, signal }),

  introPrepare: (b: { venue: Address; linkType: "personal" | "broadcast" }) => post<{ intro: IntroStruct; typedData: TypedDataJson }>("/intros/prepare", b),
  introCreate: (b: { intro: IntroStruct; signature: Hex; note?: string }) => post<{ code: string; url: string; introHash: Hex }>("/intros", b),
  intro: (code: string) => get<IntroGet>(`/intros/${code}`, { auth: false }),
  introOpen: (code: string) => post<{ recorded: boolean; countsForAttribution?: boolean }>(`/intros/${code}/opens`),
  introAcceptPrepare: (code: string) => post<{ acceptance: { introHash: Hex; customer: Address; deadline: U }; typedData: TypedDataJson }>(`/intros/${code}/accept/prepare`),
  introAccept: (code: string, b: { acceptance: { introHash: Hex; customer: Address; deadline: U }; signature: Hex }) =>
    post<{ status: "pending"; txHash: Hex; relayId: string; introHash: Hex }>(`/intros/${code}/accept`, b),
  myLinks: () => get<{ links: MyLink[] }>("/me/links"),

  quote: (b: { venue: Address; orderId: Hex; whoSentYou?: Address | null }) => post<QuoteRes>("/payments/quote", b),
  pay: (b: { intentId: string; signature: Hex }) => post<{ intentId: string; status: "pending"; txHash: Hex; relayId: string }>("/payments", b),
  intent: (id: string) => get<IntentRes>(`/payments/${id}`),

  wallet: () => get<WalletRes>("/me/wallet"),
  activity: () => get<{ address: Address; items: ActivityItemJson[] }>("/me/activity"),
  ambassador: (a: string) => get<AmbassadorRes>(`/ambassadors/${a}`, { auth: false }),
  relay: (id: string) => get<RelayRes>(`/relay/${id}`),

  demoTopupStatus: () => get<DemoTopupStatus>("/demo/topup"),
  demoTopup: () => post<DemoTopupRes>("/demo/topup"),
};

/** Poll a relay job until mined (or failed). Used as the fallback when SSE is late. */
export async function waitRelay(relayId: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RelayRes> {
  const t0 = Date.now();
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const r = await api.relay(relayId);
    if (r.status === "mined") return r;
    if (r.status === "failed" || r.status === "reverted") throw new ApiError(502, r.errorCode ?? "TX_FAILED", FRIENDLY[r.errorCode ?? "TX_FAILED"] ?? FRIENDLY.TX_FAILED, false);
    if (Date.now() - t0 > (opts.timeoutMs ?? 90_000)) throw new ApiError(504, "TIMEOUT", "This is taking longer than usual. We'll keep checking.", true);
    await new Promise((res) => setTimeout(res, 800));
  }
}
