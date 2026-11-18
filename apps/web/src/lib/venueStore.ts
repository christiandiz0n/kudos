/** The venue this device last managed, per owner account (convenience only; the API session is the truth). */
const key = (owner: string) => `vouch.venue.${owner.toLowerCase()}`;

export function lastVenue(owner: string): string | null {
  try {
    return localStorage.getItem(key(owner));
  } catch {
    return null;
  }
}
export function rememberVenue(owner: string, venue: string): void {
  try {
    localStorage.setItem(key(owner), venue);
  } catch {
    /* ignore */
  }
}
