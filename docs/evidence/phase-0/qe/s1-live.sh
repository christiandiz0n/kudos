#!/usr/bin/env bash
# QE_E2E independent S1 re-derivation (read-only RPC/HTTP calls; no keys, no txs).
# Usage: bash docs/evidence/phase-0/qe/s1-live.sh > docs/evidence/phase-0/qe/s1-live.txt 2>&1
set -u
CAST="$HOME/.foundry/bin/cast"
RPC=https://rpc.testnet.arc.io
LEG=https://rpc.testnet.arc.network
QN=https://rpc.quicknode.testnet.arc.io
USDC=0x3600000000000000000000000000000000000000
echo "# run at $(date -u +%FT%TZ)"
echo "== chain id (canonical / legacy / quicknode public)"
$CAST chain-id --rpc-url $RPC
$CAST chain-id --rpc-url $LEG
$CAST chain-id --rpc-url $QN
curl -s -X POST $RPC -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'; echo
curl -s -X POST $RPC -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"net_version","params":[]}'; echo
echo "== CORS preflight on canonical RPC"
curl -s -o /dev/null -D - -X OPTIONS $RPC -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | grep -i '^access-control' || echo "(no CORS headers)"
echo "== WS canonical (eth_chainId over websocket via cast)"
$CAST chain-id --rpc-url wss://rpc.testnet.arc.io 2>&1 | head -2
echo "== block number on both"
$CAST block-number --rpc-url $RPC
$CAST block-number --rpc-url $LEG
echo "== explorer"
curl -s -o /dev/null -w 'explorer.testnet.arc.io: %{http_code}\n' https://explorer.testnet.arc.io/
curl -s https://explorer.testnet.arc.io/ | grep -o '<title>[^<]*</title>' | head -1
curl -s -o /dev/null -D - https://testnet.arcscan.app/ | grep -iE '^(HTTP|location)'
curl -s -o /dev/null -D - 'https://testnet.arcscan.app/api?module=block&action=eth_block_number' | grep -iE '^(HTTP|location)'
curl -s 'https://explorer.testnet.arc.io/api?module=block&action=eth_block_number'; echo
echo "== USDC metadata"
for f in "name()(string)" "symbol()(string)" "decimals()(uint8)" "version()(string)" "DOMAIN_SEPARATOR()(bytes32)" "totalSupply()(uint256)"; do
  printf '%-30s ' "$f"; $CAST call $USDC "$f" --rpc-url $RPC 2>&1
done
printf '%-30s ' "eip712Domain()"; $CAST call $USDC "eip712Domain()" --rpc-url $RPC 2>&1 | head -1
echo "== computed DOMAIN_SEPARATOR {USDC,2,5042002,0x3600..}"
TH=$($CAST keccak "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
$CAST keccak $($CAST abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" $TH $($CAST keccak USDC) $($CAST keccak 2) 5042002 $USDC)
echo "== proxy / implementation"
printf 'proxy code bytes: '; $CAST codesize $USDC --rpc-url $RPC
IMPL_SLOT=$($CAST keccak "org.zeppelinos.proxy.implementation")
echo "zos impl slot $IMPL_SLOT -> $($CAST storage $USDC $IMPL_SLOT --rpc-url $RPC)"
printf 'implementation() via call: '; $CAST call $USDC "implementation()(address)" --rpc-url $RPC 2>&1 | head -1
IMPL=0xc6ad664ac6679f4ce74e10e91449c93ec1ae3ca6
printf 'impl code bytes: '; $CAST codesize $IMPL --rpc-url $RPC
curl -s https://explorer.testnet.arc.io/api/v2/smart-contracts/$IMPL | python3 -I -c "import json,sys;d=json.load(sys.stdin);print('blockscout impl name:',d.get('name'),'| compiler:',d.get('compiler_version'),'| verified_at:',d.get('verified_at'))"
echo "== selectors in impl bytecode (PUSH4 scan)"
CODE=$($CAST code $IMPL --rpc-url $RPC)
for s in "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)" "permit(address,address,uint256,uint256,bytes)" \
  "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)" \
  "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)" \
  "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)" \
  "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)" \
  "cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)" "cancelAuthorization(address,bytes32,bytes)" \
  "authorizationState(address,bytes32)" "nonces(address)" "DOMAIN_SEPARATOR()" "eip712Domain()"; do
  sel=$($CAST sig "$s"); hex=${sel#0x}
  if printf '%s' "$CODE" | grep -qi "63$hex"; then st=PRESENT; else st=absent; fi
  printf '%-100s %s %s\n' "$s" "$sel" "$st"
done
echo "== typehashes live vs computed"
for pair in "RECEIVE_WITH_AUTHORIZATION_TYPEHASH()(bytes32)|ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)" \
  "TRANSFER_WITH_AUTHORIZATION_TYPEHASH()(bytes32)|TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)" \
  "PERMIT_TYPEHASH()(bytes32)|Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"; do
  fn=${pair%%|*}; ts=${pair#*|}
  live=$($CAST call $USDC "$fn" --rpc-url $RPC 2>&1); comp=$($CAST keccak "$ts")
  [ "$live" = "$comp" ] && m=MATCH || m=DIFF
  echo "$fn live=$live computed=$comp $m"
done
echo "== native vs ERC-20 (1e12) for every address in wallets.public.json"
for a in $(python3 -I -c "import json,sys;print(' '.join(json.load(open(sys.argv[1])).values()))" "$(dirname "$0")/../../../../packages/shared/src/wallets.public.json"); do
  B=$($CAST block-number --rpc-url $RPC)
  n=$($CAST balance $a --block $B --rpc-url $RPC); e=$($CAST call $USDC "balanceOf(address)(uint256)" $a --block $B --rpc-url $RPC | awk '{print $1}')
  python3 -I -c "import sys;n,e=int(sys.argv[1]),int(sys.argv[2]);print(f'{sys.argv[3]} @{sys.argv[4]} native={n} erc20={e} native//1e12={n//10**12} equal={n//10**12==e} dust={n%10**12}')" "$n" "$e" "$a" "$B"
done
echo "== base fee floor"
B=$($CAST block-number --rpc-url $RPC)
$CAST block $B --rpc-url $RPC --json | python3 -I -c "import json,sys;b=json.load(sys.stdin);print('block',int(b['number'],16),'baseFee',int(b['baseFeePerGas'],16),'gasLimit',int(b['gasLimit'],16),'extraData',b['extraData'],'->uint64',int(b['extraData'],16) if len(b['extraData'])<=18 else 'n/a','mixHash',b['mixHash'])"
printf 'eth_gasPrice: '; $CAST gas-price --rpc-url $RPC
curl -s -X POST $RPC -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x14","latest",[]]}' | python3 -I -c "import json,sys;r=json.load(sys.stdin)['result'];print('feeHistory baseFees (gwei):',sorted(set(int(x,16)/1e9 for x in r['baseFeePerGas'])))"
echo "== block time over 10000 blocks"
python3 -I - "$B" <<'PY'
import json,sys,urllib.request
B=int(sys.argv[1])
def ts(n):
    req=urllib.request.Request("https://rpc.testnet.arc.io",data=json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[hex(n),False]}).encode(),headers={"content-type":"application/json"})
    return int(json.load(urllib.request.urlopen(req))["result"]["timestamp"],16)
print("avg block time s =", round((ts(B)-ts(B-10000))/10000,4))
PY
echo "== getLogs range cap (from=B-10000 to=B  => 10001 blocks; and 10000; and 9999)"
for span in 10000 9999 9998; do
  F=$((B-span)); printf 'span %s (inclusive %s blocks): ' $span $((span+1))
  curl -s -X POST $RPC -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{\"fromBlock\":\"$(printf '0x%x' $F)\",\"toBlock\":\"$(printf '0x%x' $B)\",\"address\":\"0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32\"}]}" | head -c 200; echo
done
printf 'research repro 0x1..0x2712: '
curl -s -X POST $RPC -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x1","toBlock":"0x2712"}]}' | head -c 200; echo
printf 'research repro 0x1..0x2711: '
curl -s -X POST $RPC -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x1","toBlock":"0x2711"}]}' | head -c 200; echo
echo "== predeploys code size"
for a in 0x0000000071727De22E5E9d8BAf0edAc6f37da032 0xcA11bde05977b3631167028862bE2a173976CA11 0x000000000022D473030F116dDEE9F6B43aC78BA3; do printf '%s ' $a; $CAST codesize $a --rpc-url $RPC; done
