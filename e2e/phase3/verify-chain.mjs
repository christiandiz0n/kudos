// QE_E2E: independent on-chain check of a pay tx (Arc public RPC; no api code). Decodes USDC Transfer logs in the receipt.
//   node e2e/phase3/verify-chain.mjs <txHash> <amountBaseUnits> [expectJson]
const RPC = "https://rpc.testnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000";
const VOUCH = "0xf4b641dc628de05336aa983b07d5d181254ff08e";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const [tx, amountArg] = process.argv.slice(2);
const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
};
const rc = await rpc("eth_getTransactionReceipt", [tx]);
const txo = await rpc("eth_getTransactionByHash", [tx]);
const blk = await rpc("eth_getBlockByNumber", [rc.blockNumber, false]);
const addr = (t) => `0x${t.slice(26)}`.toLowerCase();
const transfers = rc.logs.filter((l) => l.address.toLowerCase() === USDC && l.topics[0] === TRANSFER).map((l) => ({ from: addr(l.topics[1]), to: addr(l.topics[2]), value: BigInt(l.data) }));
const into = transfers.filter((t) => t.to === VOUCH).reduce((a, t) => a + t.value, 0n);
const outOf = transfers.filter((t) => t.from === VOUCH);
const sumOut = outOf.reduce((a, t) => a + t.value, 0n);
const amount = BigInt(amountArg);
const out = {
  tx, status: rc.status, block: Number(rc.blockNumber), blockTime: new Date(Number(blk.timestamp) * 1000).toISOString(), from: txo.from, to: rc.to, gasUsed: Number(rc.gasUsed), effectiveGasPrice: rc.effectiveGasPrice,
  feeUsdc: Number(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice)) / 1e18,
  intoVouch: into.toString(), outOfVouch: outOf.map((t) => ({ to: t.to, value: t.value.toString(), usd: Number(t.value) / 1e6 })), sumOut: sumOut.toString(),
  exact: into === amount && sumOut === amount,
};
console.log(JSON.stringify(out, null, 2));
