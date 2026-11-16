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
    address: '0xF4B641dc628de05336aa983B07D5d181254ff08e',
    deployBlock: 72605845,
    deployTx: '0x7a9bd4b1f61888606b91e2a58f6a61efa2761e810216b04730addfead8dc2709',
    usdc: '0x3600000000000000000000000000000000000000',
    verified: true,
    deployedAt: '2026-11-16T22:18:40Z',
  },
};

/** The Arc Testnet deployment (the one the app, relayer and Streams use). */
export const VOUCH_ARC_TESTNET: VouchDeployment = VOUCH_DEPLOYMENTS[5042002]!;

export interface RetiredVouchDeployment {
  chainId: number;
  address: Address;
  deployBlock: number;
  deployTx: Hex;
  /** The deployment that replaced it. */
  retiredBy: Address;
}

/** RETIRED deployments, newest first. Never send transactions to these; listed only for history and log forensics. */
export const VOUCH_RETIRED_DEPLOYMENTS: readonly RetiredVouchDeployment[] = [
  { chainId: 5042002, address: '0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f', deployBlock: 72584790, deployTx: '0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab', retiredBy: '0xF4B641dc628de05336aa983B07D5d181254ff08e' },
  { chainId: 5042002, address: '0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3', deployBlock: 72580272, deployTx: '0xe3648ea62c60c46f92c30ff3753d907bc4b626417ffcee282883ff1f3a16016f', retiredBy: '0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f' },
];
