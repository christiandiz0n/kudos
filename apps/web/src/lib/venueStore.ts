import { api } from "./api";

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

/**
 * Is `me` the owner of `venue`? (QE-3-05: only the owner's session can take orders.) Uses the venue's owner from
 * GET /venues/:venue when known, else this session's own venues (GET /auth/session). Unknown → false (read-only).
 */
export async function isVenueOwner(venue: string, owner: string | null | undefined, me: string): Promise<boolean> {
  if (owner) return owner.toLowerCase() === me.toLowerCase();
  try {
    const s = await api.session();
    return s.venues.some((v) => v.venue.toLowerCase() === venue.toLowerCase());
  } catch {
    return false;
  }
}
