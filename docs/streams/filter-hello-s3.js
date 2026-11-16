// QuickNode Streams filter — dataset `logs` (Vouch). Rendered + base64-encoded by scripts/streams/streams.ts.
//
// Placeholders (filled by the CLI with JSON literals; leave the `/*__X__*/` markers intact):
//   ADDRESSES  lowercase contract addresses to keep
//   TOPICS     { "<topic0 lowercase>": "<EventName>" } — keys are the allowed topic0s
//
// Sandbox (docs: quicknode.com/docs/streams/filters): must define `main`; no require/import/network/fs/eval.
// Return null → nothing is delivered for this batch (credits are still billed per block processed).
//
// Payload nesting is handled defensively. Docs show `stream.data` as [block][receipt][log] (JSON spec and the
// REST-API filter example) while the prose says "array of arrays"; with "metadata in body" off the data may also
// arrive without the {data, metadata} wrapper. We walk arrays (and receipt-like `logs` arrays) to any depth ≤ 8.
//
// Delivered body (envelope v1): { v, streamId, network, dataset, batchStart, batchEnd, events: [log + `event`] }.
// Numbers that arrive as hex (blockNumber, transactionIndex, logIndex, blockTimestamp) are converted to numbers.
// batchStart/batchEnd come from metadata.batch_{start,end}_range; when the input arrives unwrapped (no metadata),
// they fall back to min/max blockNumber over ALL logs in the input (batchSource: 'logs') — a lower bound on the
// real batch, since blocks without logs are invisible (QE-15). The `batch-*` HTTP headers remain authoritative.

const ADDRESSES = ["0x66cb4392322b2aede460a4314ce092e0cc1c2b32"];
const TOPICS = {
  "0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55": "Ping",
  "0x42fb8796ffe3237a1f58f3e03a85a890f71c1582e5ef97e78936c4f5b6968cd9": "Split"
};

function collectLogs(node, out, depth) {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) collectLogs(node[i], out, depth + 1);
    return;
  }
  if (Array.isArray(node.topics)) {
    out.push(node);
    return;
  }
  if (Array.isArray(node.logs)) collectLogs(node.logs, out, depth + 1);
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.length > 0) return v.indexOf('0x') === 0 ? parseInt(v, 16) : Number(v);
  return null;
}

function main(stream) {
  const root = stream && stream.data !== undefined ? stream.data : stream;
  const meta = (stream && stream.metadata) || {};
  const logs = [];
  collectLogs(root, logs, 0);

  const allowed = {};
  for (let i = 0; i < ADDRESSES.length; i++) allowed[String(ADDRESSES[i]).toLowerCase()] = true;

  const events = [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const address = typeof log.address === 'string' ? log.address.toLowerCase() : '';
    if (!allowed[address]) continue;
    const topic0 = typeof log.topics[0] === 'string' ? log.topics[0].toLowerCase() : '';
    if (!Object.prototype.hasOwnProperty.call(TOPICS, topic0)) continue;
    const ev = {
      event: TOPICS[topic0],
      address: address,
      topics: log.topics,
      data: log.data,
      blockNumber: toNum(log.blockNumber),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: toNum(log.transactionIndex),
      logIndex: toNum(log.logIndex),
      removed: !!log.removed,
    };
    if (log.blockTimestamp !== undefined) ev.blockTimestamp = toNum(log.blockTimestamp);
    events.push(ev);
  }

  if (events.length === 0) return null;
  let batchStart = toNum(meta.batch_start_range);
  let batchEnd = toNum(meta.batch_end_range);
  let batchSource = 'metadata';
  if (batchStart === null && batchEnd === null) {
    batchSource = 'logs';
    for (let i = 0; i < logs.length; i++) {
      const b = toNum(logs[i].blockNumber);
      if (b === null || b !== b) continue;
      if (batchStart === null || b < batchStart) batchStart = b;
      if (batchEnd === null || b > batchEnd) batchEnd = b;
    }
  }
  return {
    v: 1,
    streamId: meta.stream_id,
    network: meta.network,
    dataset: meta.dataset,
    batchStart: batchStart,
    batchEnd: batchEnd,
    batchSource: batchSource,
    events: events,
  };
}
