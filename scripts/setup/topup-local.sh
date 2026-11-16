#!/usr/bin/env bash
# Local proof for scripts/setup/topup-demo.ts: anvil -> MockUSDC (6-dec) -> exercise
# dry-run, top-up, partial top-up, skip, idempotent re-run, reserve-abort, max-total-abort, ad-hoc --to,
# bad-name. Asserts balances with cast after each case, then kills anvil.
#
# Uses anvil's PUBLIC default dev mnemonic (local only). Targets are the real public demo addresses from
# packages/shared/src/wallets.public.json, which on anvil are just empty accounts.
# Usage: bash scripts/setup/topup-local.sh   (from anywhere)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$PATH:$HOME/.foundry/bin"
PORT="${TOPUP_ANVIL_PORT:-8547}"
RPC="http://127.0.0.1:${PORT}"
MNEMONIC="test test test test test test test test test test test junk" # anvil default (public)

for bin in anvil forge cast pnpm python3; do
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

DEPLOYER_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 0)"
DEPLOYER_ADDR="$(cast wallet address --private-key "$DEPLOYER_KEY")"

W="$ROOT/packages/shared/src/wallets.public.json"
addr() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$W" "$1"; }
ANA="$(addr DEMO_ANA)"; BEN="$(addr DEMO_BEN)"; PRIYA="$(addr DEMO_PRIYA)"
LENA="$(addr DEMO_LENA)"; SPIKE="$(addr SPIKE_USER)"; RELAYER="$(addr RELAYER)"
ADHOC="0x000000000000000000000000000000000000bEEF"

echo "== deploying MockUSDC"
DEPLOY_OUT="$(cd "$ROOT/contracts" && forge create src/spikes/MockUSDC.sol:MockUSDC \
  --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast 2>&1)"
USDC="$(echo "$DEPLOY_OUT" | sed -n 's/.*Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p' | head -1)"
[[ -n "$USDC" ]] || { echo "$DEPLOY_OUT"; echo "deploy failed"; exit 1; }
echo "USDC_ADDRESS=$USDC"

mint() { cast send "$USDC" 'mint(address,uint256)' "$1" "$2" --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" >/dev/null; }
bal() { cast call "$USDC" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | awk '{print $1}'; }
PASS=0
check() { # name addr expected_base_units
  local got; got="$(bal "$2")"
  if [[ "$got" == "$3" ]]; then echo "  ok   $1 = $got"; PASS=$((PASS + 1)); else echo "  FAIL $1 = $got, expected $3"; exit 1; fi
}
expect_exit() { # expected_code label -- cmd...
  local want="$1" label="$2"; shift 3
  set +e; "$@"; local code=$?; set -e
  if [[ "$code" == "$want" ]]; then echo "  ok   $label exit=$code"; PASS=$((PASS + 1)); else echo "  FAIL $label exit=$code, expected $want"; exit 1; fi
}

# Starting state: deployer $30.00, BEN already above target ($6.00), ANA partially funded ($2.50).
mint "$DEPLOYER_ADDR" 30000000
mint "$BEN" 6000000
mint "$ANA" 2500000

cd "$ROOT/scripts"
topup() { ARC_RPC_URL="$RPC" USDC_ADDRESS="$USDC" DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" pnpm exec tsx setup/topup-demo.ts "$@"; }

echo; echo "===== CASE 1: dry run (default set, target 5.00) -> plan only"
expect_exit 0 "dry-run" -- topup --dry-run
check deployer "$DEPLOYER_ADDR" 30000000
check DEMO_PRIYA "$PRIYA" 0

echo; echo "===== CASE 2: real top-up (ANA partial 2.50, BEN skip, PRIYA/LENA/SPIKE 5.00 each)"
expect_exit 0 "topup" -- topup
check DEMO_ANA "$ANA" 5000000
check DEMO_BEN "$BEN" 6000000
check DEMO_PRIYA "$PRIYA" 5000000
check DEMO_LENA "$LENA" 5000000
check SPIKE_USER "$SPIKE" 5000000
check deployer "$DEPLOYER_ADDR" 12500000

echo; echo "===== CASE 3: re-run -> every target skipped, nothing sent"
expect_exit 0 "idempotent re-run" -- topup
check deployer "$DEPLOYER_ADDR" 12500000

echo; echo "===== CASE 4: reserve abort (RELAYER to 10.00 would leave deployer 2.50 < reserve 5.00)"
expect_exit 2 "reserve-abort" -- topup --only RELAYER --target 10
check RELAYER "$RELAYER" 0
check deployer "$DEPLOYER_ADDR" 12500000

echo; echo "===== CASE 5: max-total abort (ad-hoc 3.00 > --max-total 2.00, reserve fine)"
expect_exit 2 "max-total-abort" -- topup --to "$ADHOC" --target 3 --max-total 2
check ad-hoc "$ADHOC" 0
check deployer "$DEPLOYER_ADDR" 12500000

echo; echo "===== CASE 6: ad-hoc --to + --include-relayer (0.25 each)"
expect_exit 0 "ad-hoc+relayer" -- topup --to "$ADHOC" --include-relayer --target 0.25
check ad-hoc "$ADHOC" 250000
check RELAYER "$RELAYER" 250000
check deployer "$DEPLOYER_ADDR" 12000000

echo; echo "===== CASE 7: bad input (unknown name, float-precision amount)"
expect_exit 1 "unknown-name" -- topup --only BOGUS --dry-run
expect_exit 1 "too-many-decimals" -- topup --target 1.0000001 --dry-run

echo; echo "== ALL CASES PASSED ($PASS checks)"
