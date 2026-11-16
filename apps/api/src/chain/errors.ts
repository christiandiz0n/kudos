/**
 * Revert → friendly error mapping, and classification of node errors seen while sending.
 * Every contract revert is deterministic for the same calldata, so all of them are TERMINAL for the job (never
 * retried); only transport / nonce / fee problems are retried by the relayer.
 */
import { BaseError } from 'viem';
import { ApiError, type ErrorCode } from '../http/errors';
import type { Revert } from './client';

const BY_NAME: Record<string, ErrorCode> = {
  OrderExpired: 'ORDER_EXPIRED',
  OrderAlreadySettled: 'ORDER_ALREADY_PAID', // QE-C-10: terminal; the split is read from PaymentSettled
  AuthExpired: 'PAYMENT_EXPIRED',
  AuthMismatch: 'BAD_REQUEST',
  InvalidVenueSignature: 'VENUE_NOT_MANAGED',
  InvalidAmount: 'INVALID_AMOUNT',
  UnauthorizedSubmitter: 'UNAUTHORIZED_SUBMITTER',
  CustomerAlreadyVerified: 'ALREADY_REWARDED',
  IntroAlreadyUsed: 'INTRO_ALREADY_USED',
  IntroExpired: 'INTRO_EXPIRED',
  IntroHashMismatch: 'INVALID_SIGNATURE',
  InvalidIntroWindow: 'INTRO_EXPIRED',
  InvalidLinkType: 'BAD_REQUEST',
  InvalidCustomerSignature: 'INVALID_SIGNATURE',
  InvalidReferrerSignature: 'INVALID_SIGNATURE',
  InvalidOwnerSignature: 'INVALID_SIGNATURE',
  InvalidAccountNonce: 'OWNER_NONCE_STALE',
  SignatureExpired: 'SIGNATURE_EXPIRED',
  TermsNotInForce: 'LINK_NEEDS_REISSUE',
  SelfReferral: 'SELF_REFERRAL',
  ReferrerNotEligible: 'REFERRER_NOT_ELIGIBLE',
  UnknownVenue: 'UNKNOWN_VENUE',
  VenueAlreadyRegistered: 'VENUE_EXISTS',
  InvalidTerms: 'INVALID_TERMS',
  InvalidPayout: 'INVALID_PAYOUT',
  ZeroAddress: 'BAD_REQUEST',
  StringTooLong: 'BAD_REQUEST',
  PayoutTransferFailed: 'TX_FAILED',
  TransferOutOfGas: 'TX_FAILED',
};

/** USDC (FiatToken) revert strings bubbled through pay(). */
function fromReason(reason: string): ErrorCode | null {
  if (/exceeds balance/i.test(reason)) return 'INSUFFICIENT_BALANCE';
  if (/authorization is used or canceled/i.test(reason)) return 'PAYMENT_ALREADY_USED';
  if (/authorization is expired/i.test(reason)) return 'PAYMENT_EXPIRED';
  if (/invalid signature/i.test(reason)) return 'INVALID_SIGNATURE';
  if (/blacklisted/i.test(reason)) return 'FORBIDDEN';
  return null;
}

export function revertCode(r: Revert): ErrorCode {
  return BY_NAME[r.name] ?? (r.reason ? fromReason(r.reason) : null) ?? 'TX_FAILED';
}

export function revertToApiError(r: Revert): ApiError {
  return new ApiError(revertCode(r), { details: { revert: r.name, ...(r.reason ? { reason: r.reason } : {}) } });
}

export type SendErrorKind = 'nonce_low' | 'already_known' | 'underpriced' | 'insufficient_funds' | 'transport' | 'other';

/** Classify an error thrown by eth_sendRawTransaction (or the transport). */
export function classifySendError(err: unknown): SendErrorKind {
  const text =
    err instanceof BaseError
      ? [err.shortMessage, err.details, err.message].join(' ')
      : err instanceof Error
        ? err.message
        : String(err);
  if (/nonce too low|nonce has already been used|NonceTooLow|invalid nonce/i.test(text)) return 'nonce_low';
  if (/already known|known transaction|AlreadyKnown/i.test(text)) return 'already_known';
  if (/underpriced|fee too low|max fee per gas less than block base fee|FeeCapTooLow/i.test(text)) return 'underpriced';
  if (/insufficient funds/i.test(text)) return 'insufficient_funds';
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|timed? ?out|socket hang up|HTTP request failed|503|502|504/i.test(text)) return 'transport';
  return 'other';
}
