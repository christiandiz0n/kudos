#!/usr/bin/env bash
# QE_E2E: independent on-chain + Blockscout verification of S2 (fresh + original) and the S5 testnet split tx.
# Read-only. Usage: bash docs/evidence/phase-0/qe/s2-verify.sh <fresh_hello> <fresh_deploy_tx> <fresh_ping_tx>
set -u
CAST="$HOME/.foundry/bin/cast"; RPC=https://rpc.testnet.arc.io; EXP=https://explorer.testnet.arc.io
PING_T0=$($CAST keccak "Ping(address,bytes32,uint256)"); SPLIT_T0=$($CAST keccak "Split(address,address,address,uint256,uint256)")
echo "# run at $(date -u +%FT%TZ)"; echo "Ping topic0  $PING_T0"; echo "Split topic0 $SPLIT_T0"
check_deploy () { # addr tx label
  echo; echo "=================== $3: $1"
  printf 'code size: '; $CAST codesize "$1" --rpc-url $RPC
  $CAST receipt "$2" --rpc-url $RPC --json | python3 -I -c "import json,sys;r=json.load(sys.stdin);print('deploy receipt: status',r['status'],'block',int(r['blockNumber'],16),'contractAddress',r['contractAddress'],'from',r['from'],'gasUsed',int(r['gasUsed'],16),'effGasPrice',int(r['effectiveGasPrice'],16),'fee USDC',int(r['gasUsed'],16)*int(r['effectiveGasPrice'],16)/1e18)"
  echo "-- cast logs (Ping) for $1 from deploy block"
  DB=$($CAST receipt "$2" blockNumber --rpc-url $RPC)
  $CAST logs --from-block $DB --to-block $((DB+9000)) --address "$1" "Ping(address indexed,bytes32,uint256)" --rpc-url $RPC --json | python3 -I -c "
import json,sys
for l in json.load(sys.stdin):
  tag=bytes.fromhex(l['data'][2:66]).rstrip(b'\0').decode(errors='replace')
  print(' Ping block',int(l['blockNumber'],16),'tx',l['transactionHash'],'logIndex',int(l['logIndex'],16),'from 0x'+l['topics'][1][-40:],'tag',repr(tag),'at',int(l['data'][66:130],16),'blockTimestamp' in l and 'blockTimestamp='+str(int(l['blockTimestamp'],16)) or '')"
  echo "-- Blockscout /api/v2/addresses/$1"
  curl -s "$EXP/api/v2/addresses/$1" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(' is_contract',d.get('is_contract'),'creator',d.get('creator_address_hash'),'creation_tx',d.get('creation_transaction_hash') or d.get('creation_tx_hash'),'verified',d.get('is_verified'))"
  echo "-- Blockscout /api/v2/addresses/$1/logs"
  curl -s "$EXP/api/v2/addresses/$1/logs" | python3 -I -c "import json,sys;d=json.load(sys.stdin);[print(' log block',i.get('block_number'),'tx',i.get('transaction_hash') or i.get('tx_hash'),'topic0',(i.get('topics') or [None])[0],'decoded',(i.get('decoded') or {}).get('method_call')) for i in d.get('items',[])]"
  echo "-- Blockscout /api/v2/transactions/$2"
  curl -s "$EXP/api/v2/transactions/$2" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(' status',d.get('status'),'result',d.get('result'),'block',d.get('block_number') or d.get('block'),'created_contract',(d.get('created_contract') or {}).get('hash'),'fee',(d.get('fee') or {}).get('value'))"
}
check_deploy "$1" "$2" "FRESH (QE) deployment"
echo "-- Blockscout /api/v2/transactions/$3 (fresh ping)"
curl -s "$EXP/api/v2/transactions/$3" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(' status',d.get('status'),'result',d.get('result'),'block',d.get('block_number') or d.get('block'),'to',(d.get('to') or {}).get('hash'),'method',d.get('method'),'gas_used',d.get('gas_used'))"
echo "-- Blockscout /api/v2/transactions/$3/logs (fresh ping)"
curl -s "$EXP/api/v2/transactions/$3/logs" | python3 -I -c "import json,sys;d=json.load(sys.stdin);[print(' log addr',(i.get('address') or {}).get('hash'),'topic0',(i.get('topics') or [None])[0]) for i in d.get('items',[])]"

check_deploy 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32 0x382fa0221cf39cf3c1107ffc6e2ecfef39620ddcc4e465a4aa363fbce6410f93 "ORIGINAL (INTERFACES §2) deployment"
echo "-- original ping tx from s2-deploy.log"
$CAST receipt 0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0 --rpc-url $RPC --json | python3 -I -c "import json,sys;r=json.load(sys.stdin);print(' status',r['status'],'block',int(r['blockNumber'],16),'gasUsed',int(r['gasUsed'],16),'effGasPrice',int(r['effectiveGasPrice'],16),'fee',int(r['gasUsed'],16)*int(r['effectiveGasPrice'],16)/1e18)"

echo; echo "=================== S5 testnet split tx"
S5=0x2de25bf814b182b183ddc7657a0a20962b4c9688d5616f9c5e72f5b96f688214
$CAST receipt $S5 --rpc-url $RPC --json > "${TMPDIR:-/tmp}/qe-s5-receipt.json"
$CAST tx $S5 --rpc-url $RPC --json > "${TMPDIR:-/tmp}/qe-s5-tx.json"
python3 -I - "${TMPDIR:-/tmp}/qe-s5-receipt.json" "${TMPDIR:-/tmp}/qe-s5-tx.json" "$SPLIT_T0" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); t=json.load(open(sys.argv[2])); split_t0=sys.argv[3]
TT='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
a=lambda x:'0x'+x[-40:]
g=int(r['gasUsed'],16); p=int(r['effectiveGasPrice'],16)
print('status',r['status'],'block',int(r['blockNumber'],16),'from(relayer)',r['from'],'to',r['to'],'gasUsed',g,'effGasPrice',p,'fee wei',g*p,'fee USDC',g*p/1e18)
print('tx type',t.get('type'),'maxFeePerGas',int(t['maxFeePerGas'],16) if t.get('maxFeePerGas') else None,'maxPriorityFeePerGas',int(t['maxPriorityFeePerGas'],16) if t.get('maxPriorityFeePerGas') else None)
usdc=[];sysl=[];other=[]
for l in r['logs']:
    ad=l['address'].lower(); t0=l['topics'][0]
    if t0==split_t0:
        d=l['data'][2:]
        print('Split event: emitter',ad,'token',a(l['topics'][1]),'from',a(l['topics'][2]),'relayer',a(l['topics'][3]),'recipientCount',int(d[0:64],16),'total',int(d[64:128],16))
    elif t0==TT and ad=='0x3600000000000000000000000000000000000000': usdc.append(l)
    elif t0==TT and ad=='0xfffffffffffffffffffffffffffffffffffffffe': sysl.append(l)
    else: other.append((ad,t0))
print('USDC 0x3600 Transfer logs:',len(usdc))
tot=0
for l in usdc:
    v=int(l['data'],16); tot+=v; print('  ',a(l['topics'][1]),'->',a(l['topics'][2]),v)
print('sum of USDC transfers',tot,'=',tot/1e6,'USDC')
print('system 0xffff..fffe Transfer logs:',len(sysl),'sum(18dec)',sum(int(l['data'],16) for l in sysl))
print('other logs',other)
PY
echo "-- Blockscout /api/v2/transactions/$S5"
curl -s "$EXP/api/v2/transactions/$S5" | python3 -I -c "import json,sys;d=json.load(sys.stdin);print(' status',d.get('status'),'result',d.get('result'),'block',d.get('block_number') or d.get('block'),'gas_used',d.get('gas_used'),'gas_price',d.get('gas_price'),'fee',(d.get('fee') or {}).get('value'),'token_transfers',len(d.get('token_transfers') or []))"
curl -s "$EXP/api/v2/transactions/$S5/token-transfers" | python3 -I -c "import json,sys;d=json.load(sys.stdin);it=d.get('items',[]);print(' blockscout token-transfers',len(it),'sum',sum(int((i.get('total') or {}).get('value',0)) for i in it),[((i.get('token') or {}).get('address_hash') or (i.get('token') or {}).get('address')) for i in it][:1])"
