/** Response shapes for Streams-derived rows (the only source of "settled"). */
import type { RewardLine, SettledPayment } from '../ports/streams';
import { money } from '../http/json';

const ROLE = ['cashback', 'referrer', 'introducer'] as const;

export function lineView(l: RewardLine) {
  return {
    role: ROLE[l.role],
    roleId: l.role,
    recipient: l.recipient,
    amount: money(l.amount),
    viaReferrer: l.viaReferrer,
    returned: l.returned,
    returnReason: l.returnReason,
    orderId: l.orderId,
    venue: l.venue,
    customer: l.customer,
    txHash: l.txHash,
    blockNumber: l.blockNumber,
    blockTime: l.blockTime,
  };
}

export function settledView(p: SettledPayment) {
  return {
    source: 'streams',
    venue: p.venue,
    customer: p.customer,
    orderId: p.orderId,
    amount: money(p.amount),
    venueAmount: money(p.venueAmount),
    rewardPool: money(p.rewardPool),
    firstPurchase: p.firstPurchase,
    rewarded: p.rewarded,
    weightsMode: p.weightsMode,
    txHash: p.txHash,
    blockNumber: p.blockNumber,
    blockTime: p.blockTime,
    lines: p.lines.map(lineView),
  };
}
