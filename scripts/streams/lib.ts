/**
 * Helpers for the QuickNode Streams CLI (scripts/streams/streams.ts). No secrets are ever printed:
 * the API key only goes into the `x-api-key` header, and the webhook security token is only written to
 * the root env file (D-004 pattern) and redacted everywhere else.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toEventSelector, type AbiEvent } from 'viem';
import { helloAbi } from '@vouch/shared';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOT_ENV_FILE = path.join(REPO_ROOT, '.env');
export const FILTER_TEMPLATE = path.join(REPO_ROOT, 'infra/streams/filter-logs.js');
export const DEFAULT_NDJSON = path.join(REPO_ROOT, 'data/local/streams-spike.ndjson');
export const WEBHOOK_PATH = '/webhooks/streams';

// ---------- events / filter ----------

export interface EventSpec {
  name: string;
  signature: string;
  topic0: `0x${string}`;
}

/** `--events "Ping(address,bytes32,uint256);Split(...)"` or the preset `hello` (Hello.sol ABI). */
export function parseEvents(spec: string): EventSpec[] {
  if (spec.trim().toLowerCase() === 'hello') {
    return (helloAbi.filter((x) => x.type === 'event') as readonly AbiEvent[]).map((ev) => ({
      name: ev.name,
      signature: `${ev.name}(${ev.inputs.map((i) => i.type).join(',')})`,
      topic0: toEventSelector(ev),
    }));
  }
  return spec
    .split(';')
    .map((s) => s.trim().replace(/^event\s+/, ''))
    .filter(Boolean)
    .map((sig) => {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(sig);
      if (!m) throw new Error(`bad event signature: ${sig}`);
      return { name: m[1]!, signature: sig, topic0: toEventSelector(sig) };
    });
}

export function parseAddresses(spec: string): string[] {
  const list = spec.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const a of list) if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`bad address: ${a}`);
  if (!list.length) throw new Error('no contract address given');
  return list;
}

/** Fills the `/*__ADDRESSES__*\/ []` and `/*__TOPICS__*\/ {}` placeholders of infra/streams/filter-logs.js. */
export function renderFilter(addresses: string[], events: EventSpec[], template = readFileSync(FILTER_TEMPLATE, 'utf8')): string {
  const topics = Object.fromEntries(events.map((e) => [e.topic0.toLowerCase(), e.name]));
  const a = '/*__ADDRESSES__*/ []';
  const t = '/*__TOPICS__*/ {}';
  if (!template.includes(a) || !template.includes(t)) throw new Error('filter template placeholders not found');
  return template
    .replace(a, JSON.stringify(addresses.map((x) => x.toLowerCase())))
    .replace(t, JSON.stringify(topics, null, 2));
}

export const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
export const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

// ---------- redaction ----------

/** Strips credentials, query string and fragment (quick-tunnel URLs carry none, but custom URLs might). */
export function redactUrl(u: unknown): string {
  if (typeof u !== 'string') return String(u);
  try {
    const url = new URL(u);
    const creds = url.username || url.password;
    url.username = '';
    url.password = '';
    const q = url.search ? '?<redacted>' : '';
    const h = url.hash ? '#<redacted>' : '';
    url.search = '';
    url.hash = '';
    return `${creds ? '<creds>@' : ''}${url.toString()}${q}${h}`;
  } catch {
    return '<unparseable url>';
  }
}

const redacted = (v: unknown) => (typeof v === 'string' ? `<redacted: ${v.length} chars>` : v == null ? v : '<redacted>');

function redactAttrs(attrs: unknown): unknown {
  if (!attrs || typeof attrs !== 'object') return attrs;
  const out: Record<string, unknown> = { ...(attrs as Record<string, unknown>) };
  for (const k of ['security_token', 'secret_key', 'sas_token', 'password', 'access_key', 'ssl_key_pem']) {
    if (k in out) out[k] = redacted(out[k]);
  }
  if ('url' in out) out.url = redactUrl(out.url);
  if (out.headers && typeof out.headers === 'object') {
    out.headers = Object.fromEntries(Object.keys(out.headers as object).map((k) => [k, '<redacted>']));
  }
  return out;
}

/** Copy of a stream object safe to print (tokens/creds redacted, filter shown as length unless asked). */
export function redactStream(s: Record<string, unknown>, showFilter = false): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  out.destination_attributes = redactAttrs(s.destination_attributes);
  if (Array.isArray(s.extra_destinations)) {
    out.extra_destinations = s.extra_destinations.map((d: Record<string, unknown>) => ({
      ...d,
      destination_attributes: redactAttrs(d?.destination_attributes),
    }));
  }
  if (typeof s.filter_function === 'string') {
    out.filter_function = showFilter ? unb64(s.filter_function) : `<base64: ${s.filter_function.length} chars; --show-filter to decode>`;
  }
  return out;
}

// ---------- root env file writer ----------

/**
 * Sets KEY=value in an env file without printing it: replaces every existing `KEY=` / `export KEY=` line
 * (or appends one), keeps every other line byte-for-byte, keeps the file mode (new files get 0600),
 * and writes atomically (temp file + rename in the same directory).
 */
export async function writeEnvVar(file: string, key: string, value: string): Promise<{ replaced: number; mode: number }> {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`bad env key ${key}`);
  if (/[\r\n]/.test(value)) throw new Error('env value must be a single line');
  let text = '';
  let mode = 0o600;
  try {
    text = await readFile(file, 'utf8');
    mode = (await stat(file)).mode & 0o777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const safe = /^[A-Za-z0-9_\-.:/+=@]+$/.test(value) ? value : JSON.stringify(value);
  const line = `${key}=${safe}`;
  const re = new RegExp(`^(?:export\\s+)?${key}=.*$`, 'gm');
  let replaced = 0;
  let next = text.replace(re, () => {
    replaced++;
    return line;
  });
  if (!replaced) next = `${next}${next.length && !next.endsWith('\n') ? '\n' : ''}${line}\n`;
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, next, { mode });
  await chmod(tmp, mode);
  await rename(tmp, file);
  return { replaced, mode };
}

// ---------- QuickNode REST client ----------

export const QN_API_BASE = process.env.QUICKNODE_STREAMS_API_BASE ?? 'https://api.quicknode.com/streams/rest/v1';

export class QnError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly detail: string,
  ) {
    super(`HTTP ${status} ${statusText}${detail ? ` — ${detail}` : ''}`);
  }
}

export function apiKey(): string {
  const k = process.env.QUICKNODE_STREAMS_API_KEY;
  if (!k || /^__.*__$/.test(k.trim())) {
    throw new Error('QUICKNODE_STREAMS_API_KEY is not set in the root env file (run via `pnpm --filter @vouch/scripts streams …`)');
  }
  return k.trim();
}

/** Non-revealing description of the configured API key (length + character classes only). */
export function describeKey(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return { present: false };
  const k = raw;
  return {
    present: true,
    placeholder: /^__.*__$/.test(k.trim()),
    length: k.length,
    trimmedLength: k.trim().length,
    hasWhitespace: /\s/.test(k),
    hasQuotes: /["']/.test(k),
    looksLikeUrl: /^https?:\/\//i.test(k.trim()),
    startsWithQN_: /^QN_/i.test(k.trim()),
    charset: /^[A-Za-z0-9_-]+$/.test(k.trim()) ? 'alnum/_-' : 'other',
  };
}

/** Removes the API key and any known token from text before it is printed. */
export function scrub(text: string, extra: string[] = []): string {
  let out = text;
  for (const s of [process.env.QUICKNODE_STREAMS_API_KEY, process.env.STREAMS_WEBHOOK_SECRET, ...extra]) {
    if (s && s.length >= 8) out = out.split(s).join('<redacted>');
  }
  return out.replace(/("security_token"\s*:\s*")[^"]*"/g, '$1<redacted>"');
}

function errorDetail(json: unknown, text: string): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const nested = o.error && typeof o.error === 'object' ? (o.error as Record<string, unknown>) : {};
    const parts = [nested.name, nested.message, o.error, o.message, o.msg, o.detail]
      .flat()
      .filter((x) => typeof x === 'string' && x.length);
    if (parts.length) return scrub([...new Set(parts as string[])].join('; '));
  }
  return scrub(text.slice(0, 500));
}

export async function qn<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  p: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${QN_API_BASE}${p}`, {
    method,
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw new QnError(res.status, res.statusText, errorDetail(json, text));
  return { status: res.status, json: json as T, text };
}

/** Ensures the webhook URL targets our route: a bare origin gets `/webhooks/streams` appended. */
export function normalizeWebhookUrl(u: string): { url: string; appended: boolean } {
  const url = new URL(u);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('webhook URL must be https');
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = WEBHOOK_PATH;
    return { url: url.toString(), appended: true };
  }
  return { url: url.toString(), appended: false };
}
