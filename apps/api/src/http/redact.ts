/**
 * Redaction for logs and error details (SEC-2-03, SEC-2-07). URLs are reduced to "<url>" (a keyed ARC_RPC_URL must
 * never reach a log line or a response), and a `token` query parameter is stripped from request URLs.
 */

/** Remove every http(s)/ws(s) URL and anything that looks like a bearer token. */
export function scrub(text: string, max = 300): string {
  return text
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '<url>')
    .replace(/\bv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<token>')
    .slice(0, max);
}

export function errText(e: unknown): string {
  return scrub(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
}

/** "/events/user/0x…?token=v1.a.b&x=1" → "/events/user/0x…?token=[redacted]&x=1" */
export function redactUrl(url: string): string {
  const i = url.indexOf('?');
  if (i < 0) return url;
  const qs = url
    .slice(i + 1)
    .split('&')
    .map((kv) => (/^(token|access_token|auth|signature)=/i.test(kv) ? `${kv.split('=')[0]}=[redacted]` : kv))
    .join('&');
  return `${url.slice(0, i)}?${qs}`;
}
