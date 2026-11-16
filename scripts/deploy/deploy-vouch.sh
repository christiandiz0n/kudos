#!/usr/bin/env bash
# Deploy the production Vouch contract to Arc Testnet with the DEPLOYER key, verify it on Blockscout, and write
# packages/shared/src/deployments.ts (address, deploy block, tx). Loads the root env file itself (agents never read
# it, D-004). Prints addresses / tx hashes only — never keys, never a keyed RPC URL.
#
# Usage (repo root):
#   bash scripts/deploy/deploy-vouch.sh                 # deploy + verify + write deployments.ts
#   bash scripts/deploy/deploy-vouch.sh --verify 0xADDR # (re)verify an existing deployment + write deployments.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a
RPC="${ARC_RPC_URL:-https://rpc.testnet.arc.io}"
USDC="0x3600000000000000000000000000000000000000"
EXPLORER="https://explorer.testnet.arc.io"
VERIFIER_URL="$EXPLORER/api/"
cd "$ROOT/contracts"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN_ID" = "5042002" ] || { echo "refusing: chain id $CHAIN_ID is not Arc Testnet (5042002)"; exit 1; }
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
echo "== chain $CHAIN_ID, deployer $DEPLOYER, balance $(cast call "$USDC" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC" | cut -d' ' -f1) (USDC 6-dec)"

if [ "${1:-}" = "--verify" ]; then
  VOUCH="${2:?usage: --verify 0xADDR}"
  RUN="broadcast/DeployVouch.s.sol/$CHAIN_ID/run-latest.json"
  DEPLOY_TX="$(python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(next(r['transactionHash'] for r in d['receipts'] if (r.get('contractAddress') or '').lower()==sys.argv[2].lower()))" "$RUN" "$VOUCH")"
else
  echo "== forge build + deploy Vouch(USDC=$USDC)"
  forge build --silent
  if ! OUT="$(USDC_ADDRESS="$USDC" forge script script/DeployVouch.s.sol:DeployVouch --rpc-url "$RPC" --broadcast --slow 2>&1)"; then
    printf '%s\n' "$OUT" | grep -v -i "rpc" | tail -25
    echo "deploy failed"
    exit 1
  fi
  VOUCH="$(printf '%s\n' "$OUT" | sed -n 's/.*VOUCH_ADDRESS=\(0x[0-9a-fA-F]\{40\}\).*/\1/p' | head -1)"
  [ -n "$VOUCH" ] || { printf '%s\n' "$OUT" | tail -20; echo "could not parse VOUCH_ADDRESS"; exit 1; }
  RUN="broadcast/DeployVouch.s.sol/$CHAIN_ID/run-latest.json"
  DEPLOY_TX="$(python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['receipts'][0]['transactionHash'])" "$RUN")"
fi

RECEIPT="$(cast receipt "$DEPLOY_TX" --rpc-url "$RPC" --json)"
read -r DEPLOY_BLOCK GAS_USED GAS_PRICE STATUS < <(printf '%s' "$RECEIPT" | python3 -I -c "import json,sys;r=json.load(sys.stdin);print(int(r['blockNumber'],16), int(r['gasUsed'],16), int(r['effectiveGasPrice'],16), int(r['status'],16))")
[ "$STATUS" = "1" ] || { echo "deploy tx failed: $DEPLOY_TX"; exit 1; }
echo "VOUCH_ADDRESS=$VOUCH"
echo "DEPLOY_TX=$DEPLOY_TX"
echo "DEPLOY_BLOCK=$DEPLOY_BLOCK"
python3 -I -c "import sys;g,p=int(sys.argv[1]),int(sys.argv[2]);print(f'deploy gasUsed={g} effectiveGasPrice={p} fee={g*p/1e18:.6f} USDC')" "$GAS_USED" "$GAS_PRICE"

echo "== verify on Blockscout"
VERIFIED=false
CTOR_ARGS="$(cast abi-encode 'constructor(address)' "$USDC")"
for attempt in 1 2 3 4 5; do
  if VOUT="$(forge verify-contract "$VOUCH" src/Vouch.sol:Vouch --chain-id "$CHAIN_ID" \
      --verifier blockscout --verifier-url "$VERIFIER_URL" --constructor-args "$CTOR_ARGS" --watch 2>&1)"; then
    printf '%s\n' "$VOUT" | grep -iE "verif|status|success|already|GUID" | tail -6
    VERIFIED=true
    break
  fi
  printf '%s\n' "$VOUT" | tail -4
  echo "verify attempt $attempt failed; retrying in 10s"
  sleep 10
done

DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 -I - "$ROOT/packages/shared/src/deployments.ts" "$CHAIN_ID" "$VOUCH" "$DEPLOY_BLOCK" "$DEPLOY_TX" "$USDC" "$VERIFIED" "$DEPLOYED_AT" <<'PY'
import sys
out, chain, addr, block, tx, usdc, verified, at = sys.argv[1:9]
src = f"""/**
 * Deployed Vouch contracts. WRITTEN BY scripts/deploy/deploy-vouch.sh — do not edit by hand.
 * `deployBlock` is the backfill / Streams start_range.
 */
import type {{ Address, Hex }} from 'viem';

export interface VouchDeployment {{
  chainId: number;
  address: Address;
  deployBlock: number;
  deployTx: Hex;
  usdc: Address;
  verified: boolean;
  deployedAt: string;
}}

export const VOUCH_DEPLOYMENTS: Record<number, VouchDeployment> = {{
  {chain}: {{
    chainId: {chain},
    address: '{addr}',
    deployBlock: {block},
    deployTx: '{tx}',
    usdc: '{usdc}',
    verified: {verified},
    deployedAt: '{at}',
  }},
}};

/** The Arc Testnet deployment (the one the app, relayer and Streams use). */
export const VOUCH_ARC_TESTNET: VouchDeployment = VOUCH_DEPLOYMENTS[{chain}]!;
"""
open(out, 'w').write(src)
print(f"wrote {out}")
PY
echo "Explorer: $EXPLORER/address/$VOUCH"
echo "Deploy tx: $EXPLORER/tx/$DEPLOY_TX"
