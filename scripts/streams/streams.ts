/**
 * QuickNode Streams CLI (Vouch, STREAMS_INFRA). REST API: https://www.quicknode.com/docs/streams/rest-api
 * (OpenAPI: https://api.quicknode.com/streams/rest/openapi.json). Auth header `x-api-key`.
 *
 * Run from the repo root (loads the root env file via tsx --env-file-if-exists, D-004):
 *   pnpm --filter @vouch/scripts streams <command> [options]
 *
 * Commands:
 *   list                                   streams with status, range, destination (redacted)
 *   get <id> [--show-filter]               one stream (tokens redacted)
 *   create --name <n> --contract <addr[,addr]> --events "<sig>;<sig>"|hello --start <block>|latest
 *          --webhook <url> [--end <block>] [--batch-size 5] [--region usa_east] [--status active|paused]
 *          [--external-id <id>] [--max-retry 20] [--dry-run]
 *                                          creates a logs stream on arc-testnet with infra/streams/filter-logs.js;
 *                                          saves the returned security token as STREAMS_WEBHOOK_SECRET (never printed)
 *   pause <id> | activate <id>
 *   delete <id> --yes
 *   set-webhook <id> <url>                 change the destination URL (quick-tunnel URLs change); keeps the token
 *   sync-secret <id>                       re-save the stream's current security token into the root env file
 *   test-filter --contract … --events … --block <n> [--dry-run]
 *                                          POST /streams/test_filter against one real block (creates nothing)
 *   render-filter --contract … --events …  print the rendered filter JS (no API call)
 *   key-info                               shape of QUICKNODE_STREAMS_API_KEY (length/charset only, never the key)
 */
import { parseArgs } from 'node:util';
import { ARC_TESTNET_RPC_URL } from '@vouch/shared';
import {
  QN_API_BASE,
  QnError,
  ROOT_ENV_FILE,
  b64,
  describeKey,
  normalizeWebhookUrl,
  parseAddresses,
  parseEvents,
  qn,
  redactStream,
  redactUrl,
  renderFilter,
  scrub,
  writeEnvVar,
} from './lib';

const NETWORK = 'arc-testnet';
const DATASET = 'logs';

type Stream = Record<string, unknown> & {
  id?: string;
  name?: string;
  status?: string;
  network?: string;
  dataset?: string;
  start_range?: number | null;
  end_range?: number | null;
  sequence?: number | null;
  destination?: string;
  destination_attributes?: Record<string, unknown>;
};

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    name: { type: 'string' },
    contract: { type: 'string' },
    events: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    webhook: { type: 'string' },
    region: { type: 'string', default: 'usa_east' },
    'batch-size': { type: 'string', default: '5' },
    status: { type: 'string', default: 'active' },
    'external-id': { type: 'string' },
    'max-retry': { type: 'string', default: '20' },
    block: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'show-filter': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [cmd, ...args] = positionals;

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === '') throw new Error(`missing ${what}`);
  return v;
}

function intOpt(v: string | undefined, what: string): number {
  const n = Number(need(v, what));
  if (!Number.isInteger(n)) throw new Error(`${what} must be an integer`);
  return n;
}

function contracts(): string[] {
  const fromEnv = process.env.HELLO_ADDRESS;
  const usable = fromEnv && !/^0x0{40}$/i.test(fromEnv) ? fromEnv : undefined;
  return parseAddresses(need(opt.contract ?? usable, '--contract <address> (or HELLO_ADDRESS in env)'));
}

function filterFromOpts() {
  const addresses = contracts();
  const events = parseEvents(need(opt.events, '--events "<sig1>;<sig2>" (or "hello")'));
  const source = renderFilter(addresses, events);
  return { addresses, events, source };
}

function printEvents(addresses: string[], events: ReturnType<typeof parseEvents>) {
  console.log(`contracts: ${addresses.join(', ')}`);
  for (const e of events) console.log(`  ${e.topic0}  ${e.signature}`);
}

const rangeStr = (s: Stream) =>
  `${s.start_range ?? 'latest'} → ${s.end_range == null || s.end_range === -1 ? 'tip (continuous)' : s.end_range}`;

function printStreamLine(s: Stream) {
  const a = s.destination_attributes ?? {};
  console.log(
    [
      `id=${s.id}`,
      `name=${JSON.stringify(s.name)}`,
      `status=${s.status}`,
      `network=${s.network}`,
      `dataset=${s.dataset}`,
      `range=${rangeStr(s)}`,
      `sequence=${s.sequence ?? '-'}`,
      `batch=${s.dataset_batch_size ?? '-'}${s.elastic_batch_enabled ? '+elastic' : ''}`,
      `dest=${s.destination}:${redactUrl(a.url)}`,
      `token=${typeof a.security_token === 'string' ? `set(${a.security_token.length} chars)` : 'none'}`,
    ].join('  '),
  );
}

async function saveToken(token: unknown, source: string) {
  if (typeof token !== 'string' || token.length === 0) {
    console.log(`! no security token in the ${source}. Run \`streams sync-secret <id>\`, or copy it from the dashboard (stream → Settings) into STREAMS_WEBHOOK_SECRET.`);
    return false;
  }
  const { replaced } = await writeEnvVar(ROOT_ENV_FILE, 'STREAMS_WEBHOOK_SECRET', token);
  process.env.STREAMS_WEBHOOK_SECRET = token;
  console.log(`security token saved (${token.length} chars) as STREAMS_WEBHOOK_SECRET in the root env file (${replaced ? 'replaced existing line' : 'appended'}). Restart the api to load it.`);
  return true;
}

/** Current Arc testnet block from the public RPC (null on failure; informational only). */
async function arcTip(): Promise<number | null> {
  try {
    const res = await fetch(ARC_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await res.json()) as { result?: string };
    return j.result ? Number.parseInt(j.result, 16) : null;
  } catch {
    return null;
  }
}

async function getStream(id: string): Promise<Stream> {
  return (await qn<Stream>('GET', `/streams/${encodeURIComponent(id)}`)).json;
}

async function main() {
  switch (cmd) {
    case 'list': {
      const { json } = await qn<{ data?: Stream[]; pageInfo?: { total?: number } } | Stream[]>('GET', '/streams?limit=100&offset=0');
      const list = Array.isArray(json) ? json : (json?.data ?? []);
      const total = Array.isArray(json) ? list.length : (json?.pageInfo?.total ?? list.length);
      console.log(`${QN_API_BASE} — ${total} stream(s)`);
      for (const s of list) printStreamLine(s);
      if (opt.json) console.log(JSON.stringify(list.map((s) => redactStream(s)), null, 2));
      return;
    }

    case 'get': {
      const s = await getStream(need(args[0], '<id>'));
      printStreamLine(s);
      console.log(JSON.stringify(redactStream(s, opt['show-filter']), null, 2));
      return;
    }

    case 'enabled-count': {
      const { status, json } = await qn('GET', '/streams/enabled_count');
      console.log(`enabled_count: HTTP ${status} ${JSON.stringify(json)}`);
      return;
    }

    case 'key-info': {
      // Diagnoses a rejected key without revealing it (length/charset only).
      console.log(JSON.stringify(describeKey(process.env.QUICKNODE_STREAMS_API_KEY)));
      return;
    }

    case 'render-filter': {
      const { addresses, events, source } = filterFromOpts();
      printEvents(addresses, events);
      console.log(source);
      return;
    }

    case 'create': {
      const name = need(opt.name, '--name');
      const { addresses, events, source } = filterFromOpts();
      const startRaw = need(opt.start, '--start <block>|latest');
      const start = startRaw === 'latest' ? undefined : intOpt(startRaw, '--start');
      const end = opt.end !== undefined ? intOpt(opt.end, '--end') : -1;
      const { url, appended } = normalizeWebhookUrl(need(opt.webhook, '--webhook <https url>'));
      const batch = intOpt(opt['batch-size'], '--batch-size');
      if (end === -1 && batch < 5) throw new Error('Arc has sub-second blocks: tip streams need --batch-size >= 5 (API returns 422 otherwise)');
      if (!['active', 'paused'].includes(opt.status!)) throw new Error('--status must be active|paused');
      const externalId = opt['external-id'] ?? `vouch-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

      // Request schema: https://www.quicknode.com/docs/streams/rest-api/create-stream (CreateStreamDto in the OpenAPI).
      // security_token is omitted on purpose: "Omit it on create and one is generated for you; the stream response includes it".
      const body = {
        name,
        network: NETWORK,
        dataset: DATASET,
        filter_function: b64(source),
        filter_language: 'javascript',
        region: opt.region,
        ...(start !== undefined ? { start_range: start } : {}),
        end_range: end,
        dataset_batch_size: batch,
        elastic_batch_enabled: true,
        fix_block_reorgs: 0,
        keep_distance_from_tip: 0,
        destination: 'webhook',
        destination_attributes: {
          url,
          compression: 'none',
          headers: {},
          max_retry: intOpt(opt['max-retry'], '--max-retry'),
          retry_interval_sec: 1,
          post_timeout_sec: 15,
        },
        status: opt.status,
        external_id: externalId,
      };

      if (appended) console.log(`note: appended ${new URL(url).pathname} to the webhook origin`);
      printEvents(addresses, events);
      const tip = await arcTip();
      if (tip !== null && start !== undefined) {
        const backlog = Math.max(0, tip - start);
        console.log(`arc tip ${tip}; backlog from start ${start} = ${backlog} blocks (~${((backlog * 0.7) / 3600).toFixed(1)} h of chain) — every block is billed, matches or not`);
      }
      if (opt['dry-run']) {
        console.log(`DRY RUN — would POST ${QN_API_BASE}/streams`);
        console.log(`headers: { "x-api-key": "<redacted>", "content-type": "application/json", "Idempotency-Key": ${JSON.stringify(externalId)} }`);
        console.log(JSON.stringify({ ...body, filter_function: `<base64 of the filter below: ${body.filter_function.length} chars>` }, null, 2));
        console.log('--- filter_function (decoded) ---');
        console.log(source);
        return;
      }

      const res = await qn<Stream>('POST', '/streams', body, { 'Idempotency-Key': externalId });
      const s = res.json;
      if (res.status === 200) console.log(`! a stream with external_id ${externalId} already existed — returned unchanged (nothing created)`);
      else console.log(`created (HTTP ${res.status})`);
      printStreamLine(s);
      if (!(await saveToken(s.destination_attributes?.security_token, 'create response'))) {
        if (s.id) await saveToken((await getStream(s.id)).destination_attributes?.security_token, 'GET /streams/{id} response');
      }
      console.log(`STREAM_ID=${s.id}`);
      if (s.status === 'active') console.log('stream is ACTIVE and billing per block — pause it when idle: streams pause <id>');
      return;
    }

    case 'test-filter': {
      const { addresses, events, source } = filterFromOpts();
      const block = String(intOpt(opt.block, '--block <n>'));
      const body = { network: NETWORK, dataset: DATASET, filter_function: b64(source), filter_language: 'javascript', block };
      printEvents(addresses, events);
      if (opt['dry-run']) {
        console.log(`DRY RUN — would POST ${QN_API_BASE}/streams/test_filter`);
        console.log(JSON.stringify({ ...body, filter_function: `<base64: ${body.filter_function.length} chars>` }, null, 2));
        return;
      }
      const { status, json, text } = await qn<{ logs?: unknown[]; result?: unknown }>('POST', '/streams/test_filter', body);
      console.log(`test_filter block ${block}: HTTP ${status}`);
      if (json && typeof json === 'object') {
        if (Array.isArray(json.logs) && json.logs.length) console.log('filter console logs:', JSON.stringify(json.logs, null, 2));
        let result = json.result;
        if (typeof result === 'string') {
          try {
            result = JSON.parse(result);
          } catch {
            /* keep string */
          }
        }
        console.log('result:', JSON.stringify(result, null, 2));
        const other = Object.keys(json).filter((k) => k !== 'logs' && k !== 'result');
        if (other.length) console.log('other response fields:', scrub(JSON.stringify(Object.fromEntries(other.map((k) => [k, (json as Record<string, unknown>)[k]])))));
      } else console.log(scrub(text));
      return;
    }

    case 'pause':
    case 'activate': {
      const id = need(args[0], '<id>');
      const { status } = await qn('POST', `/streams/${encodeURIComponent(id)}/${cmd}`);
      console.log(`${cmd}: HTTP ${status}`);
      printStreamLine(await getStream(id));
      return;
    }

    case 'delete': {
      const id = need(args[0], '<id>');
      if (!opt.yes) throw new Error('refusing to delete without --yes');
      const { status } = await qn('DELETE', `/streams/${encodeURIComponent(id)}`);
      console.log(`deleted ${id}: HTTP ${status}`);
      return;
    }

    case 'set-webhook': {
      const id = need(args[0], '<id>');
      const { url, appended } = normalizeWebhookUrl(need(args[1], '<url>'));
      const cur = await getStream(id);
      if (cur.destination !== 'webhook') throw new Error(`stream destination is ${cur.destination}, not webhook`);
      const a = cur.destination_attributes ?? {};
      // Update schema: https://www.quicknode.com/docs/streams/rest-api/update-stream — webhook attrs require
      // url/compression/max_retry/retry_interval_sec/post_timeout_sec; omitting security_token keeps the current one.
      const patch = {
        destination: 'webhook',
        destination_attributes: {
          url,
          compression: a.compression ?? 'none',
          headers: a.headers ?? {},
          max_retry: a.max_retry ?? 20,
          retry_interval_sec: a.retry_interval_sec ?? 1,
          post_timeout_sec: a.post_timeout_sec ?? 15,
        },
      };
      if (appended) console.log(`note: appended ${new URL(url).pathname} to the webhook origin`);
      console.log(`${redactUrl(a.url)} → ${redactUrl(url)}`);
      if (opt['dry-run']) {
        console.log(JSON.stringify(patch, null, 2));
        return;
      }
      const { status, json } = await qn<Stream>('PATCH', `/streams/${encodeURIComponent(id)}`, patch);
      console.log(`set-webhook: HTTP ${status}`);
      printStreamLine(json);
      const tok = json?.destination_attributes?.security_token;
      if (typeof tok === 'string' && tok.length && tok !== process.env.STREAMS_WEBHOOK_SECRET) {
        console.log('! security token in the response differs from STREAMS_WEBHOOK_SECRET — saving the new one');
        await saveToken(tok, 'update response');
      }
      return;
    }

    case 'sync-secret': {
      const s = await getStream(need(args[0], '<id>'));
      await saveToken(s.destination_attributes?.security_token, 'GET /streams/{id} response');
      return;
    }

    default: {
      const doc = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!;
      console.log(doc.replace(/^\/\*\*?|^ \* ?/gm, ''));
      if (cmd && !opt.help) process.exitCode = 2;
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof QnError) console.error(`QuickNode API error: ${err.message}`);
  else console.error(`error: ${scrub((err as Error).message ?? String(err))}`);
  process.exitCode = 1;
});
