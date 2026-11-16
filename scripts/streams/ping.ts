/**
 * S3 trigger: calls Hello.ping(tag) once on Arc testnet so the Stream has an event to deliver.
 *
 *   pnpm --silent --filter @vouch/scripts streams:ping --hello <addr> [--tag <text>]
 *
 * The target is `--hello` (alias `--contract`); it falls back to HELLO_ADDRESS from the root env file only if
 * no flag is given. The canonical S3 Hello is in AGENTS/INTERFACES.md §2 — pass it explicitly (QE-02).
 * Fails loudly when the address is zero/placeholder or has no code. The sender is SPIKE_USER_PRIVATE_KEY,
 * else DEPLOYER_PRIVATE_KEY (root env file, loaded by tsx). Prints target, sender, tx hash and block only.
 */
import { parseArgs } from 'node:util';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  stringToHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_MIN_MAX_FEE_PER_GAS, ARC_TESTNET_RPC_URL, arcTestnet, explorerTxUrl, helloAbi } from '@vouch/shared';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hello: { type: 'string' },
    contract: { type: 'string' },
    tag: { type: 'string' },
  },
});

const usable = (v: string | undefined) => (v && !/^__.*__$/.test(v.trim()) ? v.trim() : undefined);

const fromFlag = opt.hello ?? opt.contract;
const raw = fromFlag ?? usable(process.env.HELLO_ADDRESS);
const source = fromFlag ? (opt.hello ? '--hello' : '--contract') : 'HELLO_ADDRESS (root env file)';
if (!raw) throw new Error('no target: pass --hello <address> (canonical S3 Hello: AGENTS/INTERFACES.md §2)');
if (!isAddress(raw, { strict: false })) throw new Error(`target from ${source} is not an address: ${raw}`);
const hello = getAddress(raw);
if (/^0x0{40}$/i.test(hello)) throw new Error(`target from ${source} is the zero address — pass --hello <address>`);

const keyName = usable(process.env.SPIKE_USER_PRIVATE_KEY) ? 'SPIKE_USER_PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY';
const key = usable(process.env[keyName]) as Hex | undefined;
if (!key) throw new Error('need SPIKE_USER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in the root env file');
const rpc = usable(process.env.ARC_RPC_URL) ?? ARC_TESTNET_RPC_URL;
const chain = { ...arcTestnet, rpcUrls: { default: { http: [rpc] } } };
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, account, transport: http(rpc) });

console.log(`target=${hello} (from ${source})`);
const code = await pub.getCode({ address: hello });
if (!code || code === '0x') throw new Error(`no contract code at ${hello} on chain ${chain.id} — wrong address?`);

const tag = stringToHex(opt.tag ?? positionals[0] ?? `s3-${new Date().toISOString().slice(11, 19)}`, { size: 32 });
const est = await pub.estimateFeesPerGas();
const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
const maxPriorityFeePerGas = est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas;

const hash = await wallet.writeContract({
  address: hello,
  abi: helloAbi,
  functionName: 'ping',
  args: [tag],
  maxFeePerGas,
  maxPriorityFeePerGas,
});
const rcpt = await pub.waitForTransactionReceipt({ hash });
const pings = parseEventLogs({ abi: helloAbi, logs: rcpt.logs, eventName: 'Ping' });
console.log(`sender=${account.address} (${keyName})`);
console.log(`PING_TX=${hash}`);
console.log(`PING_BLOCK=${rcpt.blockNumber}`);
console.log(`status=${rcpt.status} pingLogs=${pings.length} logIndex=${pings[0]?.logIndex ?? '-'}`);
console.log(explorerTxUrl(hash));
