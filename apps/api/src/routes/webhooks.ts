import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * S3 spike stub: POST /webhooks/streams appends the raw body + headers to an NDJSON file
 * (default data/local/streams-spike.ndjson, gitignored) and returns 200. No parsing, no auth yet —
 * signature verification (STREAMS_WEBHOOK_SECRET) is added by STREAMS_INFRA once S3 confirms the
 * QuickNode header/HMAC format.
 */
export async function webhookRoutes(app: FastifyInstance, opts: { logFile: string }) {
  // Raw body for every content type inside this plugin scope (needed later for HMAC verification).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/streams', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const encoded = Boolean(req.headers['content-encoding']);
    const record = {
      receivedAt: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      bytes: raw.length,
      ...(encoded ? { bodyBase64: raw.toString('base64') } : { body: raw.toString('utf8') }),
    };
    await mkdir(path.dirname(opts.logFile), { recursive: true });
    await appendFile(opts.logFile, `${JSON.stringify(record)}\n`);
    req.log.info({ bytes: raw.length }, 'streams webhook received');
    return reply.code(200).send({ ok: true, bytes: raw.length });
  });
}
