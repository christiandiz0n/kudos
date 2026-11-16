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

const ADDRESSES = ["0xf4b641dc628de05336aa983b07d5d181254ff08e"];
const TOPICS = {
  "0xca816bf56b298971c59e72dcd003c06b351b66ffedb5ec84017d6195ec0152c8": "CustomerVerified",
  "0xe75b5b5d835a46c918feb6cac867d2b1c6ed4d45a112ebaf7067bb9c1fcf37fc": "IntroAccepted",
  "0x71760f14b6c295e573eb0712240020bcabda6d58907c0f3897ecf55f9ec193ea": "IntroDropped",
  "0x35f580066b94268579e33474e66ad0347864c26fe8683e577efb5072c80e7432": "PaymentSettled",
  "0xd28b9898dcd3318ef486fd51dbeba03ddb126bdb888b82d4ac7504213412b36a": "RewardPaid",
  "0x1cba477ed7240b8110e7fecc9c7f6fd041255365455d9c76f2b2febb4cfb7a15": "RewardReturned",
  "0x213904416ef720404e57b83f59ff9f8b5029132b1581c57443cf044b11a835b2": "SeedAmbassadorSet",
  "0x86d80d9334324698e8c0763e1f6a4179b0ae6af2e64a9724746ce284ec78bb8b": "TermsUpdated",
  "0xc518545d9074ed155beb97a3caed0bbecc0d2cdcdee6d6d2d16a079883ab2ee2": "VenueKeysUpdated",
  "0xf0f4291fd5fccc2af9a998b6cf8aba2121c99823a21bcfac7a4821537f004d77": "VenueRegistered"
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
