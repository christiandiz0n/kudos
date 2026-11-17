/**
 * App-level hardening used by `buildApp` (D-809):
 *   - request log serializer: URL logged without `token` query values and with no full URLs in error messages (SEC-2-03/07)
 *   - trustProxy: only Railway's internal proxy range (100.64.0.0/10) by default, so `req.ip` is the client from
 *     X-Forwarded-For while a client-supplied leftmost XFF entry is never trusted (SEC-2-04). TRUST_PROXY overrides:
 *     "off" | a hop count | a comma-separated CIDR/IP list.
 *   - security headers on every non-hijacked response (SEC-2-13); a lenient API CSP
 *   - standard `{error:{…}}` body for unknown routes (SEC-2-08)
 *   - CORS methods/headers the routes actually use (PATCH included)
 */
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { ApiError } from './errors';
import { redactUrl, scrub } from './redact';

export const RAILWAY_PROXY_CIDR = '100.64.0.0/10';

export type TrustProxy = boolean | string | ((address: string, hop: number) => boolean);

export function resolveTrustProxy(v: string | undefined = process.env.TRUST_PROXY): TrustProxy {
  const s = v?.trim();
  if (!s) return RAILWAY_PROXY_CIDR;
  if (/^(off|false|0|no)$/i.test(s)) return false;
  if (/^\d+$/.test(s)) {
    const hops = Number(s);
    return (_address: string, hop: number) => hop < hops;
  }
  // Never blanket-trust: "true" is treated as the Railway range.
  if (/^(on|true|yes)$/i.test(s)) return RAILWAY_PROXY_CIDR;
  return s;
}

interface SerializableReq {
  method: string;
  url: string;
  ip?: string;
  host?: string;
  hostname?: string;
  socket?: { remotePort?: number };
}

export const logSerializers = {
  req(req: SerializableReq) {
    return { method: req.method, url: redactUrl(req.url), host: req.host ?? req.hostname, remoteAddress: req.ip, remotePort: req.socket?.remotePort };
  },
  err(e: Error & { code?: string; statusCode?: number }) {
    return { type: e.name, message: scrub(e.message ?? '', 500), code: e.code, statusCode: e.statusCode, stack: e.stack ? scrub(e.stack, 2_000) : '' };
  },
};

export function fastifyOptions(logger: boolean | { stream: NodeJS.WritableStream }): FastifyServerOptions {
  return {
    logger: logger === false ? false : { serializers: logSerializers, ...(typeof logger === 'object' ? { stream: logger.stream } : {}) },
    trustProxy: resolveTrustProxy(),
  };
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
  'x-permitted-cross-domain-policies': 'none',
};

export function applySecurity(app: FastifyInstance) {
  app.addHook('onSend', async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(k)) reply.header(k, v);
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send(new ApiError('NOT_FOUND').toJSON());
  });
}

export function corsOptions(origins: string[]) {
  return {
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  };
}
