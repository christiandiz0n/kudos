/**
 * Contract ABIs. CONTRACTS exports production ABIs here (Phase 1). For now only the S2/S5 spike ABI,
 * hand-written to match contracts/src/spikes/Hello.sol (kept small on purpose).
 */
export const helloAbi = [
  {
    type: 'function',
    name: 'ping',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tag', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pullAndSplit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'relayedSplit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Ping',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'tag', type: 'bytes32', indexed: false },
      { name: 'at', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Split',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'relayer', type: 'address', indexed: true },
      { name: 'recipientCount', type: 'uint256', indexed: false },
      { name: 'total', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 ABI (approve/allowance/balanceOf/decimals). */
export const erc20MinAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;
