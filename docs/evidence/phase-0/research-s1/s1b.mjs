const RPC = process.argv[2] || 'https://rpc.testnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';
let id = 1;
const rpc = async (method, params = []) => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: id++, method, params });
  for (let a = 0; a < 3; a++) {
    const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json();
    if (j.error && j.error.code === -32014) { await new Promise((r) => setTimeout(r, 500)); continue; }
    return j;
  }
};
const H = (x) => BigInt(x);
const log = (...a) => console.log(...a);

const head = H((await rpc('eth_blockNumber')).result);
log('eth_blockNumber =', head.toString());
const latest = (await rpc('eth_getBlockByNumber', ['0x' + (head - 2n).toString(16), false])).result;
const older = (await rpc('eth_getBlockByNumber', ['0x' + (head - 2n - 10000n).toString(16), false])).result;
const n1 = H(latest.number), n0 = H(older.number), t1 = H(latest.timestamp), t0 = H(older.timestamp);
log('block', n1.toString(), 'timestamp', t1.toString(), new Date(Number(t1) * 1000).toISOString(), 'baseFeePerGas', H(latest.baseFeePerGas).toString(), 'wei (', Number(H(latest.baseFeePerGas)) / 1e9, 'gwei )', 'gasLimit', H(latest.gasLimit).toString(), 'extraData', latest.extraData, 'mixHash(prevrandao)', latest.mixHash, 'txs', latest.transactions.length);
log('block', n0.toString(), 'timestamp', t0.toString(), new Date(Number(t0) * 1000).toISOString());
log('avg block time over', (n1 - n0).toString(), 'blocks =', Number(t1 - t0) / Number(n1 - n0), 's');
if (latest.extraData && latest.extraData.length >= 18) log('extraData as uint64 (next base fee, wei) =', H('0x' + latest.extraData.slice(2, 18)).toString());

const gp = H((await rpc('eth_gasPrice')).result);
log('eth_gasPrice =', gp.toString(), 'wei =', Number(gp) / 1e9, 'gwei');
const fh = (await rpc('eth_feeHistory', ['0x5', 'latest', [50]])).result;
log('eth_feeHistory baseFeePerGas =', fh.baseFeePerGas.map((x) => Number(H(x)) / 1e9 + 'gwei').join(','), 'gasUsedRatio =', fh.gasUsedRatio.join(','));

// find a block with txs to pick a funded address
let addr = null;
for (let n = head - 2n; n > head - 400n && !addr; n--) {
  const b = (await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), true])).result;
  if (b && b.transactions.length) { addr = b.transactions[0].from; log('sample tx', b.transactions[0].hash, 'in block', H(b.number).toString(), 'from', addr, 'type', b.transactions[0].type); }
}
if (addr) {
  const tag = 'latest';
  const bal = H((await rpc('eth_getBalance', [addr, tag])).result);
  const erc = H((await rpc('eth_call', [{ to: USDC, data: '0x70a08231' + addr.slice(2).padStart(64, '0') }, tag])).result);
  log('eth_getBalance(', addr, ') =', bal.toString(), '(18-dec) =', Number(bal) / 1e18, 'USDC');
  log('USDC.balanceOf(', addr, ') =', erc.toString(), '(6-dec) =', Number(erc) / 1e6, 'USDC');
  log('native / 1e12 =', (bal / 10n ** 12n).toString(), ' equals balanceOf?', bal / 10n ** 12n === erc, ' remainder (sub-6dp dust, wei) =', (bal % 10n ** 12n).toString());
}
