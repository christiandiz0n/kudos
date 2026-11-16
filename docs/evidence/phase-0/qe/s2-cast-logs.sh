#!/usr/bin/env bash
# QE_E2E: list every Hello log (Ping/Split) with cast logs, deploy block -> min(deploy+9999, head).
set -u
CAST="$HOME/.foundry/bin/cast"; RPC=https://rpc.testnet.arc.io
echo "# $(date -u +%FT%TZ)"
H=$($CAST block-number --rpc-url $RPC)
show () {
  addr=$1; from=$2; to=$(( from + 9999 )); [ $to -gt $H ] && to=$H
  echo "== $addr blocks $from..$to"
  $CAST logs --from-block "$from" --to-block "$to" --address "$addr" --rpc-url $RPC --json | python3 -I -c '
import json,sys
P="0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55"
for l in json.load(sys.stdin):
  t0=l["topics"][0]; n="Ping" if t0==P else ("Split" if t0.startswith("0x42fb8796") else t0)
  extra=""
  if n=="Ping": extra="tag=%r at=%d" % (bytes.fromhex(l["data"][2:66]).rstrip(b"\0").decode(), int(l["data"][66:130],16))
  print(" ", n, "block", int(l["blockNumber"],16), "tx", l["transactionHash"], "logIndex", int(l["logIndex"],16), "hasBlockTimestamp", "blockTimestamp" in l, extra)'
}
show 0xc6282732b1852726F73D7Cea98cE6D03f9021906 72569134
show 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32 72567874
