/** Screen mock catalogue for /design (server-safe: no components here). */
import { CUSTOMER_SCREENS } from "./meta.customer";
import { VENUE_SCREENS } from "./meta.venue";

export interface ScreenMeta {
  id: string;
  title: string;
  who: "Customer" | "Venue" | "Public";
  note: string;
  /** Needs a fixed viewport height (full-bleed camera / overlay sheet). */
  fixed?: boolean;
  /** Desktop/projector layout instead of 390px. */
  desktop?: boolean;
  /** Public page: technical words allowed (exempt from the banned-words check). */
  technical?: boolean;
}

export const SCREENS: ScreenMeta[] = [...CUSTOMER_SCREENS, ...VENUE_SCREENS];
