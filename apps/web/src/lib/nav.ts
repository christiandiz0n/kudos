/** Only same-app relative paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/wallet"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
