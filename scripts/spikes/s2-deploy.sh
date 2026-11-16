#!/usr/bin/env bash
# S2 spike: deploy Hello to Arc testnet with the DEPLOYER key, then call ping() once.
# Loads the root env file itself (agents never read it — D-004). Prints addresses/tx hashes only.
# Usage (repo root):  bash scripts/spikes/s2-deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . "$ROOT/.env"; set +a
RPC="${ARC_RPC_URL:-https://rpc.testnet.arc.io}"

cd "$ROOT/contracts"
echo "== deploying Hello (chain $(cast chain-id --rpc-url "$RPC"))"
OUT=$(forge script script/spikes/DeployHello.s.sol --rpc-url "$RPC" --broadcast --slow 2>&1)
HELLO=$(printf '%s\n' "$OUT" | sed -n 's/.*HELLO_ADDRESS=\(0x[0-9a-fA-F]\{40\}\).*/\1/p' | head -1)
[ -n "$HELLO" ] || { printf '%s\n' "$OUT" | tail -20; echo "deploy failed"; exit 1; }
RUN=broadcast/DeployHello.s.sol/$(cast chain-id --rpc-url "$RPC")/run-latest.json
DEPLOY_TX=$(python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['receipts'][0]['transactionHash'])" "$RUN")
DEPLOY_BLOCK=$(cast receipt "$DEPLOY_TX" blockNumber --rpc-url "$RPC")
echo "HELLO_ADDRESS=$HELLO"
echo "DEPLOY_TX=$DEPLOY_TX"
echo "DEPLOY_BLOCK=$DEPLOY_BLOCK"

echo "== ping()"
TAG=$(cast format-bytes32-string "s2-ping")
PING_TX=$(cast send "$HELLO" "ping(bytes32)" "$TAG" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC" --json \
  | python3 -I -c "import json,sys;r=json.load(sys.stdin);print(r['transactionHash'], int(r['blockNumber'],16), int(r['gasUsed'],16), int(r['effectiveGasPrice'],16), r['status'])")
set -- $PING_TX
echo "PING_TX=$1 block=$2 gasUsed=$3 effectiveGasPrice=$4 status=$5"
python3 -I -c "import sys;g,p=int(sys.argv[1]),int(sys.argv[2]);print(f'ping fee = {g*p/1e18:.8f} USDC (native 18-dec gas units)')" "$3" "$4"
echo "Explorer: ${ARC_EXPLORER_URL:-https://explorer.testnet.arc.io}/address/$HELLO"
