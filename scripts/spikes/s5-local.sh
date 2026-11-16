#!/usr/bin/env bash
# S5 local proof: anvil -> deploy MockUSDC (6-dec) + Hello -> fund user -> user signs SplitAuth ->
# relayer submits relayedSplit to 7 recipients -> print gas + fee in USDC -> kill anvil.
#
# Uses anvil's PUBLIC default dev mnemonic (local only, never funded anywhere real).
# Usage: bash scripts/spikes/s5-local.sh   (from repo root; or `pnpm spike:s5:local`)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$PATH:$HOME/.foundry/bin"
PORT="${S5_ANVIL_PORT:-8546}"
RPC="http://127.0.0.1:${PORT}"
MNEMONIC="test test test test test test test test test test test junk" # anvil default (public)

for bin in anvil forge cast pnpm; do
  command -v "$bin" >/dev/null || { echo "missing $bin"; exit 1; }
done

echo "== starting anvil on :${PORT}"
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; echo "== anvil stopped"' EXIT

for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 0.2
done
echo "chainId: $(cast chain-id --rpc-url "$RPC")"

key() { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
DEPLOYER_KEY="$(key 0)"
RELAYER_KEY="$(key 1)"
USER_KEY="$(key 2)"
USER_ADDR="$(cast wallet address --private-key "$USER_KEY")"

echo "== deploying MockUSDC + Hello (forge script)"
DEPLOY_OUT="$(
  cd "$ROOT/contracts" &&
    DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" DEPLOY_MOCK_USDC=true MOCK_FUND_TO="$USER_ADDR" \
      forge script script/spikes/DeployHello.s.sol --rpc-url "$RPC" --broadcast 2>&1
)"
HELLO_ADDRESS="$(echo "$DEPLOY_OUT" | sed -n 's/.*HELLO_ADDRESS=\(0x[0-9a-fA-F]\{40\}\).*/\1/p' | head -1)"
USDC_ADDRESS="$(echo "$DEPLOY_OUT" | sed -n 's/.*USDC_ADDRESS=\(0x[0-9a-fA-F]\{40\}\).*/\1/p' | head -1)"
if [[ -z "$HELLO_ADDRESS" || -z "$USDC_ADDRESS" ]]; then
  echo "$DEPLOY_OUT"
  echo "deploy failed"
  exit 1
fi
echo "HELLO_ADDRESS=$HELLO_ADDRESS"
echo "USDC_ADDRESS=$USDC_ADDRESS"
echo "user USDC balance (6-dec base units): $(cast call "$USDC_ADDRESS" 'balanceOf(address)(uint256)' "$USER_ADDR" --rpc-url "$RPC")"

echo "== running relayer spike (tsx)"
cd "$ROOT/scripts"
RPC_URL="$RPC" USDC_ADDRESS="$USDC_ADDRESS" HELLO_ADDRESS="$HELLO_ADDRESS" \
  RELAYER_PRIVATE_KEY="$RELAYER_KEY" SPIKE_USER_PRIVATE_KEY="$USER_KEY" \
  SPLIT_TOTAL_USD="${SPLIT_TOTAL_USD:-12.00}" \
  pnpm exec tsx spikes/s5-relayer.ts
