import { defineChain, type Address } from 'viem';
import { foundry } from 'viem/chains';

/**
 * Arc Testnet (Circle's EVM L1, USDC is the native gas token).
 * VERIFIED 2026-11-15 (S1) — see D-101 / D-102 and AGENTS/INTERFACES.md §1. Correct values HERE ONLY.
 */
export const ARC_TESTNET_CHAIN_ID = 5042002; // D-101 (hex 0x4cef52)
export const ARC_TESTNET_RPC_URL = 'https://rpc.testnet.arc.io'; // D-101 canonical (open CORS, no key)
export const ARC_TESTNET_WS_URL = 'wss://rpc.testnet.arc.io'; // D-101
/** Legacy alias, still serves 5042002 (viem's built-in arcTestnet default). Prefer the canonical URL. */
export const ARC_TESTNET_RPC_URL_LEGACY = 'https://rpc.testnet.arc.network';
export const ARC_TESTNET_EXPLORER_URL = 'https://explorer.testnet.arc.io'; // D-101 (Blockscout)
export const ARC_TESTNET_EXPLORER_API_URL = 'https://explorer.testnet.arc.io/api/'; // forge --verifier blockscout

/** USDC ERC-20 interface on Arc Testnet (FiatTokenProxy -> NativeFiatTokenV2_2). D-101. */
export const ARC_TESTNET_USDC_ADDRESS: Address = '0x3600000000000000000000000000000000000000';

/** USDC ERC-20 decimals (balances, transfers, all app/contract amounts). D-102. */
export const USDC_DECIMALS = 6;

/**
 * Native gas-token decimals (gasPrice, receipt fees, eth_getBalance). Same underlying balance as the
 * ERC-20: balanceOf == floor(native / 1e12). Only relayer gas accounting touches 18-dec values. D-102.
 */
export const NATIVE_GAS_DECIMALS = 18;

/** USDC's own EIP-712 domain (for EIP-3009 ReceiveWithAuthorization / EIP-2612 permit). D-101/D-103. */
export const ARC_TESTNET_USDC_EIP712_DOMAIN = {
  name: 'USDC',
  version: '2',
  chainId: ARC_TESTNET_CHAIN_ID,
  verifyingContract: ARC_TESTNET_USDC_ADDRESS,
} as const;
/** Live DOMAIN_SEPARATOR() of Arc Testnet USDC (sanity check; the contract has no eip712Domain()). */
export const ARC_TESTNET_USDC_DOMAIN_SEPARATOR =
  '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0' as const;

/** Arc min base fee: txs with maxFeePerGas below 20 gwei are dropped. Relayer must clamp up. D-101. */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n; // 20 gwei (18-dec native units)

/**
 * EIP-7708 system emitter: every USDC transfer also emits an 18-dec system Transfer log from this address.
 * Indexers/Streams must IGNORE it and filter by our contract address only. D-102.
 */
export const ARC_SYSTEM_LOG_EMITTER: Address = '0xfffffffffffffffffffffffffffffffffffffffe';

/** eth_getLogs page limit on Arc RPC (blocks per request). D-101. */
export const ARC_GET_LOGS_MAX_RANGE = 9_999;

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: NATIVE_GAS_DECIMALS },
  rpcUrls: {
    default: { http: [ARC_TESTNET_RPC_URL], webSocket: [ARC_TESTNET_WS_URL] },
  },
  blockExplorers: {
    default: { name: 'Arc Testnet Explorer', url: ARC_TESTNET_EXPLORER_URL, apiUrl: ARC_TESTNET_EXPLORER_API_URL },
  },
  testnet: true,
});

/** Local anvil (chain id 31337) for spikes/tests. */
export const localAnvil = foundry;

export const SUPPORTED_CHAINS = { arcTestnet, localAnvil } as const;

export function explorerTxUrl(hash: string): string {
  return `${ARC_TESTNET_EXPLORER_URL}/tx/${hash}`;
}
export function explorerAddressUrl(address: string): string {
  return `${ARC_TESTNET_EXPLORER_URL}/address/${address}`;
}
