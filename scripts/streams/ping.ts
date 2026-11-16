/**
 * S3 trigger: calls Hello.ping(tag) once on Arc testnet so the Stream has an event to deliver.
 *
 *   pnpm --filter @vouch/scripts streams:ping [tag]
 *
 * Env (root env file, loaded by tsx): HELLO_ADDRESS, ARC_RPC_URL (default public RPC), and a funded key:
 * SPIKE_USER_PRIVATE_KEY, else DEPLOYER_PRIVATE_KEY. Prints the tx hash, block number and sender only.
 */
import { createPublicClient, createWalletClient, http, parseEventLogs, stringToHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_MIN_MAX_FEE_PER_GAS, ARC_TESTNET_RPC_URL, arcTestnet, explorerTxUrl, helloAbi } from '@vouch/shared';

const usable = (v: string | undefined) => (v && !/^__.*__$/.test(v) && !/^0x0+$/i.test(v) ? v : undefined);

const hello = usable(process.env.HELLO_ADDRESS) as Address | undefined;
if (!hello) throw new Error('HELLO_ADDRESS is not set in the root env file');
const keyName = usable(process.env.SPIKE_USER_PRIVATE_KEY) ? 'SPIKE_USER_PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY';
const key = usable(process.env[keyName]) as Hex | undefined;
if (!key) throw new Error('need SPIKE_USER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in the root env file');
const rpc = usable(process.env.ARC_RPC_URL) ?? ARC_TESTNET_RPC_URL;
const chain = { ...arcTestnet, rpcUrls: { default: { http: [rpc] } } };
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, account, transport: http(rpc) });

const tag = stringToHex(process.argv[2] ?? `s3-${new Date().toISOString().slice(11, 19)}`, { size: 32 });
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
