/** Screen mock catalogue for /design (server-safe: no components here). */
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

export const SCREENS: ScreenMeta[] = [
  { id: "sign-in", title: "Onboarding / sign-in", who: "Customer", note: "Passkey framed as Face ID or fingerprint. Invite context from Ana's link." },
  { id: "intro", title: "Friend's recommendation", who: "Customer", note: "Opening Ana's link while signed in. Accepting binds it to Ben." },
  { id: "wallet", title: "Wallet home", who: "Customer", note: "Balance in dollars, one primary action (Scan to pay), recent activity." },
  { id: "scan", title: "Scan to pay", who: "Customer", note: "Always-dark camera, calm viewfinder, manual fallback.", fixed: true },
  { id: "pay-confirm", title: "Confirm payment", who: "Customer", note: "Pay $12.00, you'll get $0.45 back. Who sent you here? One tap or skip.", fixed: true },
  { id: "success", title: "Payment success", who: "Customer", note: "Success mark, cashback, and the split receipt: who your $12.00 paid." },
  { id: "recommend", title: "Recommend / share", who: "Customer", note: "Personal (counts double) vs public link, a preview of what the friend sees." },
  { id: "ambassador", title: "Ambassador record", who: "Customer", note: "Ana: 14 verified customers across 5 venues. Hers, portable." },
  { id: "venue-onboarding", title: "Venue onboarding", who: "Venue", note: "Reward-rate slider with a live $12.00 example." },
  { id: "order-entry", title: "Order entry", who: "Venue", note: "Counter keypad, one action: Show code." },
  { id: "order-qr", title: "Order code", who: "Venue", note: "QR with a draining expiry ring. Waiting, then paid." },
  { id: "venue-dashboard", title: "Venue dashboard (phone)", who: "Venue", note: "Cost per new customer, latest payment graph, live feed." },
  { id: "transparency", title: "Transparency page", who: "Public", note: "Exact formula, worked example to the micro-dollar, contract + explorer links.", technical: true },
  { id: "venue-dashboard-desktop", title: "Venue dashboard (projector)", who: "Venue", note: "1440px: money graph at hero scale.", desktop: true },
];
