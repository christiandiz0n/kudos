#!/usr/bin/env bash
# Run the Arc-fork tests (contracts/test/VouchFork.t.sol) against the real Arc Testnet USDC bytecode.
# Loads the root env file itself if present (for a keyed ARC_RPC_URL; never printed), else uses the public RPC.
# Usage (repo root):  bash scripts/deploy/fork-test.sh [-vv]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
export ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.testnet.arc.io}"
cd "$ROOT/contracts"
set +e
VOUCH_FORK=true forge test --match-contract VouchForkTest "${@:--vv}" 2>&1 | grep -v -F "$ARC_RPC_URL"
exit "${PIPESTATUS[0]}"
