import { k } from './keccak.mjs';
const RPC='https://rpc.testnet.arc.io', USDC='0x3600000000000000000000000000000000000000';
const call=async(d)=>(await (await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:USDC,data:d},'latest']})})).json()).result;
const items={
 RECEIVE_WITH_AUTHORIZATION_TYPEHASH:'ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
 TRANSFER_WITH_AUTHORIZATION_TYPEHASH:'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
 PERMIT_TYPEHASH:'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'};
for (const [getter,typ] of Object.entries(items)) { const sel=k(getter+'()').slice(0,10); const live=await call(sel); const exp=k(typ); console.log(getter, 'selector', sel, '\n  live    ', live, '\n  expected', exp, live===exp?'MATCH':'MISMATCH'); }
