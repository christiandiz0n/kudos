/**
 * Venue + public screen/state catalogue for /design (UI_DESIGN venue, Phase 3). Server-safe: no components.
 * Every id renders at /design/screens/<id>. `desktop` ids are captured at 1280×720 as well.
 */
import type { ScreenMeta } from "./meta";

const V = "Venue" as const;

export const VENUE_SCREENS: ScreenMeta[] = [
  // Onboarding
  { id: "venue-onboarding", title: "Venue onboarding", who: V, note: "Name, reward slider with a live $12.00 worked example, minimum order, Face ID or fingerprint." },
  { id: "venue-onboarding-error", title: "Venue onboarding · invalid", who: V, note: "Minimum order below $0.50 + a failed save, with the D-806 message." },
  { id: "venue-onboarding-confirming", title: "Venue onboarding · confirming", who: V, note: "Waiting for Face ID or fingerprint; inputs locked." },
  // Counter
  { id: "order-entry", title: "Order entry", who: V, note: "Counter keypad, optional note, one action: Show code for $12.00." },
  { id: "order-entry-empty", title: "Order entry · empty", who: V, note: "Nothing keyed yet: Show code disabled." },
  { id: "order-entry-error", title: "Order entry · too small", who: V, note: "Below the $0.50 order floor." },
  { id: "order-qr", title: "Order code · waiting", who: V, note: "Big QR, draining expiry ring, waiting for payment." },
  { id: "order-qr-low", title: "Order code · expiring", who: V, note: "Last 20%: ring and timer turn amber." },
  { id: "order-qr-processing", title: "Order code · paying", who: V, note: "Customer confirmed; settling (2–3 s)." },
  { id: "order-qr-expired", title: "Order code · expired", who: V, note: "Expired, auto-refresh on: a new code appears by itself." },
  { id: "order-qr-refreshing", title: "Order code · new code", who: V, note: "Fetching a fresh signed order." },
  { id: "order-qr-paid", title: "Order code · paid", who: V, note: "Paid ✓ $12.00, who got what, Next order." },
  // Dashboard
  { id: "venue-dashboard", title: "Venue dashboard (phone)", who: V, note: "Cost per new customer vs typical ad, money graph (latest), payments feed." },
  { id: "venue-dashboard-network", title: "Venue dashboard · everyone", who: V, note: "Money graph in network view (20 people)." },
  { id: "venue-dashboard-visitor", title: "Venue dashboard · visitor", who: V, note: "MSG-119: someone else's place: no order button, no ad-cost input, rows say 'to the venue'." },
  { id: "venue-dashboard-cost-tiny", title: "Venue dashboard · cost under a cent", who: V, note: "MSG-101: no silly '× less' when a new customer cost almost nothing." },
  { id: "venue-dashboard-reconnecting", title: "Venue dashboard · reconnecting", who: V, note: "Live updates dropped; amber badge + note." },
  { id: "venue-dashboard-offline", title: "Venue dashboard · offline", who: V, note: "Can't reach live updates." },
  { id: "venue-dashboard-loading", title: "Venue dashboard · loading", who: V, note: "First load skeletons." },
  { id: "venue-dashboard-empty", title: "Venue dashboard · brand new", who: V, note: "No customers yet: how it works in three steps." },
  { id: "venue-dashboard-desktop", title: "Venue dashboard (projector)", who: V, note: "1280×720: money graph at hero scale, Ben's payment arriving.", desktop: true },
  { id: "venue-dashboard-desktop-network", title: "Venue dashboard (projector) · everyone", who: V, note: "60-person network, latest payment highlighted.", desktop: true },
  { id: "venue-dashboard-desktop-empty", title: "Venue dashboard (projector) · brand new", who: V, note: "Empty state at projector size.", desktop: true },
  // Money graph playground states
  { id: "money-graph-5", title: "Money graph · 5 people", who: V, note: "One payment (the demo). Landscape ≥1024px, portrait below.", desktop: true },
  { id: "money-graph-20", title: "Money graph · 20 people", who: V, note: "Network view, latest payment highlighted.", desktop: true },
  { id: "money-graph-60", title: "Money graph · 60 people", who: V, note: "Network view, the tail folded into “N more”.", desktop: true },
  // Public
  { id: "transparency", title: "Transparency page", who: "Public", note: "Exact formula, base-unit worked example, rounding rule, contract + Blockscout links, events, Streams.", technical: true },
];
