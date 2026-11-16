/**
 * Deployed Vouch contracts. WRITTEN BY scripts/deploy/deploy-vouch.sh — do not edit by hand.
 * `deployBlock` is the backfill / Streams start_range.
 */
import type { Address, Hex } from 'viem';

export interface VouchDeployment {
  chainId: number;
  address: Address;
  deployBlock: number;
  deployTx: Hex;
  usdc: Address;
  verified: boolean;
  deployedAt: string;
}

export const VOUCH_DEPLOYMENTS: Record<number, VouchDeployment> = {
  5042002: {
    chainId: 5042002,
    address: '0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3',
    deployBlock: 72580272,
    deployTx: '0xe3648ea62c60c46f92c30ff3753d907bc4b626417ffcee282883ff1f3a16016f',
    usdc: '0x3600000000000000000000000000000000000000',
    verified: true,
    deployedAt: '2026-11-16T17:21:41Z',
  },
};

/** The Arc Testnet deployment (the one the app, relayer and Streams use). */
export const VOUCH_ARC_TESTNET: VouchDeployment = VOUCH_DEPLOYMENTS[5042002]!;
