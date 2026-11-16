/**
 * Customer balance pre-flights (QE-C-11).
 *   - Relayed pay (submitter = RELAYER): the customer only needs `balance ≥ amount` (the relayer pays gas).
 *   - Self-submit (kill-the-backend demo helper / CLI only; submitter = customer, the customer's EOA sends pay()):
 *     gas is paid in USDC from the SAME balance, so `balance ≥ amount + gasLimit × maxFeePerGas` (18-dec fee rounded UP
 *     to 6-dec, D-102).
 */
import type { Address } from 'viem';
import { formatUsdc, nativeToUsdcBaseUnits } from '@vouch/shared';
import { ApiError } from '../http/errors';

export interface BalanceReader {
  usdcBalance(a: Address): Promise<bigint>;
}

export async function assertCanPayRelayed(chain: BalanceReader, customer: Address, amount: bigint): Promise<bigint> {
  const balance = await chain.usdcBalance(customer);
  if (balance < amount) {
    throw new ApiError('INSUFFICIENT_BALANCE', {
      details: { balance: balance.toString(), needed: amount.toString(), shortfall: (amount - balance).toString(), display: formatUsdc(amount - balance) },
    });
  }
  return balance;
}

export function selfSubmitNeed(amount: bigint, gasLimit: bigint, maxFeePerGas: bigint): bigint {
  return amount + nativeToUsdcBaseUnits(gasLimit * maxFeePerGas);
}

export async function assertCanSelfSubmit(
  chain: BalanceReader,
  customer: Address,
  amount: bigint,
  gasLimit: bigint,
  maxFeePerGas: bigint,
): Promise<{ balance: bigint; needed: bigint }> {
  const balance = await chain.usdcBalance(customer);
  const needed = selfSubmitNeed(amount, gasLimit, maxFeePerGas);
  if (balance < needed) {
    throw new ApiError('INSUFFICIENT_BALANCE', {
      message: "You don't have enough money for this payment plus its processing fee. Top up and try again.",
      details: { balance: balance.toString(), needed: needed.toString(), shortfall: (needed - balance).toString(), selfSubmit: true },
    });
  }
  return { balance, needed };
}
