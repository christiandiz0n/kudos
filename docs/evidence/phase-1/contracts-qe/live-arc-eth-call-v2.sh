#!/usr/bin/env bash
# MSG-003 (b) live on Arc Testnet: eth_call (read-only, no tx, no funds) of the REAL USDC receiveWithAuthorization.
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
RPC=https://rpc.testnet.arc.io
USDC=0x3600000000000000000000000000000000000000
VOUCH=${VOUCH:-0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f}   # v2 (D-512); v1 0xfEe6…b2d3 retired
THIRD=0x000000000000000000000000000000000000dEaD   # any non-payee caller (relayer / attacker)
ATTACKER=0x00000000000000000000000000000000000A77AC
# throwaway customer key, derived from a public string: holds no funds, never used on-chain
PK=$(cast keccak "vouch-qe-throwaway-customer-2026-11-16")
CUSTOMER=$(cast wallet address --private-key "$PK")
echo "chainId: $(cast chain-id --rpc-url $RPC)   block: $(cast block-number --rpc-url $RPC)"
echo "Vouch (deployed): $VOUCH   USDC: $USDC"
echo "throwaway customer: $CUSTOMER  (USDC balance: $(cast call $USDC 'balanceOf(address)(uint256)' $CUSTOMER --rpc-url $RPC))"
DS=$(cast call $USDC 'DOMAIN_SEPARATOR()(bytes32)' --rpc-url $RPC)
RWA_TH=$(cast call $USDC 'RECEIVE_WITH_AUTHORIZATION_TYPEHASH()(bytes32)' --rpc-url $RPC)
echo "USDC DOMAIN_SEPARATOR: $DS"
echo "RECEIVE_WITH_AUTHORIZATION_TYPEHASH: $RWA_TH"
NOW=$(cast block latest --field timestamp --rpc-url $RPC)
DEADLINE=$((NOW + 3600))
VENUE=$(cast call $VOUCH 'computeVenueId(address,bytes32)(address)' $CUSTOMER $(cast keccak qe-live-venue) --rpc-url $RPC)
ORDER=$(cast keccak "qe-live-order-1")
AMOUNT=12000000
WH=0x0000000000000000000000000000000000000000000000000000000000000000
SUBMITTER=0x00000000000000000000000000000000000A11CE   # v2: the bound relayer (part of the nonce)
T_AUTH=$(cast keccak "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline,address submitter)")
NONCE_LOCAL=$(cast keccak $(cast abi-encode "f(bytes32,address,address,bytes32,uint256,bytes32,uint64,address)" $T_AUTH $CUSTOMER $VENUE $ORDER $AMOUNT $WH $DEADLINE $SUBMITTER))
NONCE_CHAIN=$(cast call $VOUCH 'paymentAuthNonce((address,address,bytes32,uint256,bytes32,uint64,address))(bytes32)' "($CUSTOMER,$VENUE,$ORDER,$AMOUNT,$WH,$DEADLINE,$SUBMITTER)" --rpc-url $RPC)
echo "PaymentAuth{customer,venue=$VENUE,orderId=$ORDER,amount=$AMOUNT,weightsHash=0,deadline=$DEADLINE,submitter=$SUBMITTER}"
echo "nonce (independent keccak):        $NONCE_LOCAL"
echo "nonce (deployed paymentAuthNonce): $NONCE_CHAIN"
[ "$NONCE_LOCAL" = "$NONCE_CHAIN" ] && echo "  => equal (nonce == hashStruct(PaymentAuth))" || echo "  => MISMATCH"

sign_rwa () { # to value -> signature over ReceiveWithAuthorization{from: customer, to, value, 0, deadline, nonce}
  local SH=$(cast keccak $(cast abi-encode "f(bytes32,address,address,uint256,uint256,uint256,bytes32)" $RWA_TH $CUSTOMER $1 $2 0 $DEADLINE $NONCE_LOCAL))
  local D=$(cast keccak 0x1901${DS#0x}${SH#0x})
  cast wallet sign --no-hash --private-key "$PK" $D
}
SIG=$(sign_rwa $VOUCH $AMOUNT)
SIG0=$(sign_rwa $VOUCH 0)
SIG_FN='receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)'
call () { # label from to value sig
  echo; echo "### $1"
  echo "eth_call from=$2: USDC.$SIG_FN(from=$CUSTOMER, to=$3, value=$4, validAfter=0, validBefore=$DEADLINE, nonce=$NONCE_LOCAL, sig)"
  cast call $USDC "$SIG_FN" $CUSTOMER $3 $4 0 $DEADLINE $NONCE_LOCAL $5 --from $2 --rpc-url $RPC 2>&1 | sed 's/^/  /'
  echo "  exit=$?"
}
call "(b) third party (non-payee) redeems the customer's REAL signature for to=Vouch" $THIRD $VOUCH $AMOUNT $SIG
call "(b) the customer itself calls it directly (also not the payee)" $CUSTOMER $VOUCH $AMOUNT $SIG
call "(c) attacker names itself as payee with the same signature" $ATTACKER $ATTACKER $AMOUNT $SIG
call "control: same call simulated FROM the payee (Vouch) -> passes payee + signature checks, fails only on the empty balance" $VOUCH $VOUCH $AMOUNT $SIG
call "control: value 0 signature simulated FROM the payee (Vouch) -> succeeds (signature valid, payee == caller)" $VOUCH $VOUCH 0 $SIG0
call "control: value 0 signature from a third party -> payee check" $THIRD $VOUCH 0 $SIG0
echo; echo "authorizationState(customer, nonce) after all eth_calls: $(cast call $USDC 'authorizationState(address,bytes32)(bool)' $CUSTOMER $NONCE_LOCAL --rpc-url $RPC)  (eth_call never mutates state)"
echo; echo "v2 PAYMENT_AUTH_TYPEHASH (deployed): $(cast call $VOUCH 'PAYMENT_AUTH_TYPEHASH()(bytes32)' --rpc-url $RPC)"
echo "v2 local keccak of the type string:  $T_AUTH"
echo "USDC.transfer(1) to system addresses, simulated from the v2 deployer (payout-guard completeness):"
DEP=0x5eD3054292e9fCE089aa082997962B08fFF81111
for to in 0x1800000000000000000000000000000000000000 0xfffffffffffffffffffffffffffffffffffffffe $USDC; do
  echo "  -> $to: $(cast call $USDC 'transfer(address,uint256)(bool)' $to 1 --from $DEP --rpc-url $RPC 2>&1 | head -1)"
done
