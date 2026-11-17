/**
 * Friendly error model. Every API failure is `{ error: { code, message, retryable, details? } }`.
 * `message` is end-user copy (no "gas", "USDC", "hash", "nonce" words: D-605); `code` is the stable machine key the
 * frontend switches on. Chain reverts are mapped in `chain/errors.ts`.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'RELAYER_BUSY'
  | 'RELAYER_DOWN'
  | 'RELAYER_UNDERFUNDED'
  | 'RELAYER_BUDGET_EXHAUSTED'
  | 'SPEND_QUOTA_EXCEEDED'
  | 'TOO_MANY_CONNECTIONS'
  | 'SIGNING_UNAVAILABLE'
  | 'GAS_TOO_HIGH'
  | 'ORDER_EXPIRED'
  | 'ORDER_ALREADY_PAID'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_ALREADY_USED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_SIGNATURE'
  | 'INVALID_AMOUNT'
  | 'ALREADY_REWARDED'
  | 'INTRO_ALREADY_USED'
  | 'INTRO_EXPIRED'
  | 'LINK_NEEDS_REISSUE'
  | 'SELF_REFERRAL'
  | 'REFERRER_NOT_ELIGIBLE'
  | 'UNKNOWN_VENUE'
  | 'VENUE_EXISTS'
  | 'VENUE_NOT_MANAGED'
  | 'INVALID_TERMS'
  | 'INVALID_PAYOUT'
  | 'OWNER_NONCE_STALE'
  | 'OWNER_ACTION_PENDING'
  | 'SIGNATURE_EXPIRED'
  | 'UNAUTHORIZED_SUBMITTER'
  | 'TX_FAILED'
  | 'INTERNAL';

const DEFAULTS: Record<ErrorCode, { status: number; message: string; retryable: boolean }> = {
  BAD_REQUEST: { status: 400, message: 'Something in that request was not right.', retryable: false },
  UNAUTHENTICATED: { status: 401, message: 'Please sign in again.', retryable: false },
  FORBIDDEN: { status: 403, message: "You can't do that from this account.", retryable: false },
  NOT_FOUND: { status: 404, message: "We couldn't find that.", retryable: false },
  RATE_LIMITED: { status: 429, message: 'Too many tries. Wait a moment and try again.', retryable: true },
  RELAYER_BUSY: { status: 503, message: "We're busy right now. Try again in a few seconds.", retryable: true },
  RELAYER_DOWN: { status: 503, message: "Payments are paused right now. Your money hasn't moved. Try again shortly.", retryable: true },
  RELAYER_UNDERFUNDED: { status: 503, message: "Payments are paused right now. Your money hasn't moved. Try again shortly.", retryable: true },
  RELAYER_BUDGET_EXHAUSTED: { status: 503, message: "We've hit today's limit for free processing. Your money hasn't moved. Try again later.", retryable: true },
  SPEND_QUOTA_EXCEEDED: { status: 429, message: "You've reached the limit for now. Your money hasn't moved. Try again later.", retryable: true },
  TOO_MANY_CONNECTIONS: { status: 429, message: 'Too many live connections. Close other tabs and try again.', retryable: true },
  SIGNING_UNAVAILABLE: { status: 503, message: "This venue can't take payments right now.", retryable: true },
  GAS_TOO_HIGH: { status: 422, message: "This one is unusually expensive to process, so we stopped it. Your money hasn't moved.", retryable: false },
  ORDER_EXPIRED: { status: 410, message: 'This order has expired. Ask the venue for a new code.', retryable: false },
  ORDER_ALREADY_PAID: { status: 409, message: 'This order is already paid.', retryable: false },
  PAYMENT_EXPIRED: { status: 410, message: 'This payment took too long. Scan the code again.', retryable: false },
  PAYMENT_ALREADY_USED: { status: 409, message: 'This payment was already used. Scan the code again.', retryable: false },
  INSUFFICIENT_BALANCE: { status: 402, message: "You don't have enough money for this. Top up and try again.", retryable: false },
  INVALID_SIGNATURE: { status: 400, message: "We couldn't confirm that it was you. Try again.", retryable: false },
  INVALID_AMOUNT: { status: 400, message: 'That amount is not allowed.', retryable: false },
  ALREADY_REWARDED: { status: 409, message: "You're already a verified customer here, so this link can't be used.", retryable: false },
  INTRO_ALREADY_USED: { status: 409, message: 'This link was already used.', retryable: false },
  INTRO_EXPIRED: { status: 410, message: 'This link has expired. Ask your friend for a new one.', retryable: false },
  LINK_NEEDS_REISSUE: { status: 409, message: 'This venue changed its rewards. Ask your friend to share a fresh link.', retryable: false },
  SELF_REFERRAL: { status: 400, message: "You can't use your own link.", retryable: false },
  REFERRER_NOT_ELIGIBLE: { status: 403, message: 'Only verified customers of this venue can recommend it.', retryable: false },
  UNKNOWN_VENUE: { status: 404, message: "We couldn't find that venue.", retryable: false },
  VENUE_EXISTS: { status: 409, message: 'This venue is already registered.', retryable: false },
  VENUE_NOT_MANAGED: { status: 409, message: "This venue's codes are not managed by Vouch.", retryable: false },
  INVALID_TERMS: { status: 400, message: 'Reward rate must be between 0.01% and 50%, and the minimum order at most $10,000.', retryable: false },
  INVALID_PAYOUT: { status: 400, message: "That payout account can't receive money.", retryable: false },
  OWNER_NONCE_STALE: { status: 409, message: 'Your venue settings changed in the meantime. Please review and confirm again.', retryable: false },
  OWNER_ACTION_PENDING: { status: 409, message: 'A previous change is still being saved. Try again in a few seconds.', retryable: true },
  SIGNATURE_EXPIRED: { status: 410, message: 'That confirmation expired. Please confirm again.', retryable: false },
  UNAUTHORIZED_SUBMITTER: { status: 400, message: "We couldn't process this payment. Scan the code again.", retryable: false },
  TX_FAILED: { status: 502, message: "That didn't go through. Your money hasn't moved.", retryable: true },
  INTERNAL: { status: 500, message: 'Something went wrong on our side.', retryable: true },
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ErrorCode, opts: { message?: string; status?: number; details?: Record<string, unknown>; cause?: unknown } = {}) {
    const d = DEFAULTS[code];
    super(opts.message ?? d.message, { cause: opts.cause });
    this.code = code;
    this.status = opts.status ?? d.status;
    this.retryable = d.retryable;
    this.details = opts.details;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
