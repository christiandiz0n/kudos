#!/usr/bin/env bash
# QE_E2E Phase 2: light negative probes of POST /webhooks/streams (INTERFACES §6). No secret needed: every probe
# must be REJECTED. One request each, no load.
#   bash scripts/qa/webhook-probes.sh https://api-production-902bc54c.up.railway.app
set -u
API="${1:?usage: webhook-probes.sh <api base>}"
U="$API/webhooks/streams"
TS="$(date +%s)"
ZEROSIG="$(printf '0%.0s' $(seq 1 64))"
TMP="$(mktemp -d)"
printf '{"v":1,"events":[]}' | gzip -c > "$TMP/ok.gz"
printf 'this is not gzip' > "$TMP/garbage"

probe() { # label expected-status curl-args...
  local label="$1" want="$2"; shift 2
  local out code
  out="$(curl -s -m 20 -w '\n%{http_code}' "$@")"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [ "$code" = "$want" ]; then r=ok; else r=FAIL; fi
  printf '%-4s %-58s want %s got %s  %s\n' "$r" "$label" "$want" "$code" "$out"
}

echo "webhook probes → $U ($(date -u +%FT%TZ))"
probe "unsigned {} (no X-QN-* headers)"                      401 -X POST "$U" -H 'content-type: application/json' -d '{}'
probe "nonce+timestamp, no signature"                         401 -X POST "$U" -H 'content-type: application/json' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -d '{"v":1}'
probe "forged signature (64 zeros)"                           401 -X POST "$U" -H 'content-type: application/json' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG" -d '{"v":1}'
probe "forged signature, non-hex"                             401 -X POST "$U" -H 'content-type: application/json' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H 'x-qn-signature: not-hex' -d '{"v":1}'
probe "forged signature, envelope with a fake PaymentSettled" 401 -X POST "$U" -H 'content-type: application/json' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG" -d '{"v":1,"streamId":"qe","batchStart":1,"batchEnd":1,"events":[{"address":"0xF4B641dc628de05336aa983B07D5d181254ff08e","topics":["0x35f580066b94268579e33474e66ad0347864c26fe8683e577efb5072c80e7432"],"data":"0x","blockNumber":"0x1","transactionHash":"0x01","logIndex":"0x0"}]}'
probe "gzip body (valid gzip), forged signature"              401 -X POST "$U" -H 'content-type: application/json' -H 'content-encoding: gzip' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG" --data-binary @"$TMP/ok.gz"
probe "content-encoding gzip + garbage body, headers present" 400 -X POST "$U" -H 'content-type: application/json' -H 'content-encoding: gzip' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG" --data-binary @"$TMP/garbage"
probe "content-encoding gzip + garbage body, no headers"      401 -X POST "$U" -H 'content-type: application/json' -H 'content-encoding: gzip' --data-binary @"$TMP/garbage"
probe "text/plain garbage, forged signature"                  401 -X POST "$U" -H 'content-type: text/plain' -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG" -d 'garbage'
probe "empty body, forged signature"                          401 -X POST "$U" -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $TS" -H "x-qn-signature: $ZEROSIG"
probe "GET (wrong method)"                                    404 "$U"
rm -rf "$TMP"
