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
    address: '0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f',
    deployBlock: 72584790,
    deployTx: '0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab',
    usdc: '0x3600000000000000000000000000000000000000',
    verified: true,
    deployedAt: '2026-11-16T18:13:59Z',
  },
};

/** The Arc Testnet deployment (the one the app, relayer and Streams use). */
export const VOUCH_ARC_TESTNET: VouchDeployment = VOUCH_DEPLOYMENTS[5042002]!;
