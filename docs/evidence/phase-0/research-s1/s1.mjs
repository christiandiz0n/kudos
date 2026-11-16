import { k, kHex } from './keccak.mjs';
const RPC = process.argv[2] || 'https://rpc.testnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';
const rpc = async (method, params = []) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json());
};
const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
const log = (...a) => console.log(...a);

log('# keccak self-test');
log('keccak("") =', k(''), k('') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' ? 'OK' : 'FAIL');
log('Transfer topic =', k('Transfer(address,address,uint256)'));

log('\n# Expected DOMAIN_SEPARATOR for {name:"USDC",version:"2",chainId:5042002,verifyingContract:USDC}');
const typeHash = k('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
const ds = kHex(pad(typeHash) + pad(k('USDC')) + pad(k('2')) + pad((5042002).toString(16)) + pad(USDC));
log('computed =', ds);
const live = await rpc('eth_call', [{ to: USDC, data: '0x3644e515' }, 'latest']);
log('live     =', live.result, ds === live.result ? 'MATCH' : 'MISMATCH');

log('\n# Selector derivations');
const sigs = {
  permit: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  transferWithAuthorization: 'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  receiveWithAuthorization: 'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  'transferWithAuthorization(bytes sig)': 'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
  'receiveWithAuthorization(bytes sig)': 'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
  'permit(bytes sig)': 'permit(address,address,uint256,uint256,bytes)',
  cancelAuthorization: 'cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)',
  authorizationState: 'authorizationState(address,bytes32)',
  nonces: 'nonces(address)',
  DOMAIN_SEPARATOR: 'DOMAIN_SEPARATOR()',
  eip712Domain: 'eip712Domain()',
  version: 'version()',
  transferFrom: 'transferFrom(address,address,uint256)',
  approve: 'approve(address,uint256)',
  isBlacklisted: 'isBlacklisted(address)',
};
const sel = Object.fromEntries(Object.entries(sigs).map(([n, s]) => [n, k(s).slice(0, 10)]));
for (const [n, s] of Object.entries(sel)) log(n.padEnd(40), s, sigs[n]);

const implSlot = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
log('\n# implementation slot keccak("org.zeppelinos.proxy.implementation") =', k('org.zeppelinos.proxy.implementation'));
const implRaw = (await rpc('eth_getStorageAt', [USDC, implSlot, 'latest'])).result;
const impl = '0x' + implRaw.slice(-40);
log('implementation =', impl);
const proxyCode = (await rpc('eth_getCode', [USDC, 'latest'])).result;
const implCode = (await rpc('eth_getCode', [impl, 'latest'])).result;
log('proxy code bytes =', (proxyCode.length - 2) / 2, ' impl code bytes =', (implCode.length - 2) / 2);
// scan PUSH4 (0x63) operands in impl bytecode
const pushed = new Set();
const b = Buffer.from(implCode.slice(2), 'hex');
for (let i = 0; i < b.length; i++) {
  const op = b[i];
  if (op === 0x63) pushed.add('0x' + b.subarray(i + 1, i + 5).toString('hex'));
  if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
}
log('\n# Selector presence in implementation bytecode (PUSH4 operands)');
for (const [n, s] of Object.entries(sel)) log(n.padEnd(40), s, pushed.has(s) ? 'PRESENT' : 'absent');

log('\n# authorizationState(0x..01, 0x00..00) live call');
log(JSON.stringify(await rpc('eth_call', [{ to: USDC, data: sel.authorizationState + pad('0x01') + pad('0x00') }, 'latest'])));
