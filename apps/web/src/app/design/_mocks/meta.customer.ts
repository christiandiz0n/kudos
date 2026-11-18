/**
 * Customer screen + state catalogue for /design (UI-customer, Phase 3). Server-safe: no components.
 * Every id renders at /design/screens/<id>; design:shots reads this file to find them.
 */
import type { ScreenMeta } from "./meta";


export const CUSTOMER_SCREENS: ScreenMeta[] = [
  // Onboarding
  { id: "sign-in", title: "Onboarding / sign-in", who: "Customer", note: "Name + Continue with Face ID or fingerprint. Invite chip from Ana's link." },
  { id: "sign-in-error", title: "Sign-in: prompt cancelled", who: "Customer", note: "Face ID / fingerprint dismissed. Calm retry." },
  // Home
  { id: "wallet", title: "Home (balance)", who: "Customer", note: "Balance in dollars, money in green, one pending row, labelled demo top-up." },
  { id: "wallet-loading", title: "Home: loading", who: "Customer", note: "Skeleton balance + activity." },
  { id: "wallet-empty", title: "Home: first run", who: "Customer", note: "No payments yet: what to do next." },
  { id: "wallet-offline", title: "Home: offline", who: "Customer", note: "Last known balance with an offline note." },
  { id: "wallet-toast", title: "Home: live toast", who: "Customer", note: "A reward just arrived. Dismiss is a 44px target (QE-3-06)." },
  // Scan
  { id: "scan", title: "Scan to pay", who: "Customer", note: "Always-dark camera, calm viewfinder, manual fallback.", fixed: true },
  { id: "scan-manual", title: "Scan: type the code", who: "Customer", note: "Paste the short link while the camera runs.", fixed: true },
  { id: "scan-denied", title: "Scan: camera off", who: "Customer", note: "Camera permission denied: camera-app link or paste.", fixed: true },
  // Pay sheet
  { id: "pay-confirm", title: "Confirm payment", who: "Customer", note: "Pay $12.00, you'll get $0.45 back. Who sent you here? One tap or skip.", fixed: true },
  { id: "pay-quoting", title: "Confirm: loading", who: "Customer", note: "Quote in flight: amount known, cashback + split skeleton.", fixed: true },
  { id: "pay-repeat", title: "Confirm: already rewarded", who: "Customer", note: "Second visit: plain payment, explained kindly.", fixed: true },
  { id: "pay-insufficient", title: "Confirm: not enough money", who: "Customer", note: "Balance below amount → Top up (testnet demo).", fixed: true },
  { id: "pay-expired", title: "Confirm: code expired", who: "Customer", note: "ORDER_EXPIRED → scan a new code. Nothing charged.", fixed: true },
  { id: "pay-unavailable", title: "Confirm: service paused", who: "Customer", note: "RELAYER_DOWN → try again in a minute.", fixed: true },
  { id: "pay-failed", title: "Confirm: payment failed", who: "Customer", note: "Didn't go through. Nothing charged.", fixed: true },
  { id: "pay-cancelled", title: "Confirm: prompt cancelled", who: "Customer", note: "Face ID dismissed. Nothing charged.", fixed: true },
  { id: "pay-offline", title: "Confirm: offline", who: "Customer", note: "No connection. Nothing charged.", fixed: true },
  { id: "pay-invalid-link", title: "Confirm: link doesn't look right", who: "Customer", note: "Malformed /pay link (QE-3-01): nothing to retry, so Scan a new code.", fixed: true },
  { id: "pay-below-minimum", title: "Confirm: below the minimum", who: "Customer", note: "D-509 warning: paying now uses up the first-visit money back.", fixed: true },
  { id: "pay-no-recommendation", title: "Confirm: first visit, no recommendation", who: "Customer", note: "Nobody sent you: a regular payment, said kindly.", fixed: true },
  { id: "pay-backdrop", title: "Confirm: opened from the camera app", who: "Customer", note: "PayBackdrop behind the sheet when there's no scanner (MSG-100 #3).", fixed: true },
  // Success
  { id: "success-pending", title: "Payment: settling", who: "Customer", note: "Sent; the receipt is gray and 'Arriving' for a few seconds." },
  { id: "success", title: "Payment success", who: "Customer", note: "Green pop, cashback, and the split receipt: who your $12.00 paid." },
  { id: "success-first-visit", title: "Success: first visit, no recommendation", who: "Customer", note: "Thanks for coming in, not 'coming back' (QE-3-03)." },
  { id: "success-below-minimum", title: "Success: below the minimum", who: "Customer", note: "First visit under the venue's minimum: why there was no money back." },
  { id: "success-repeat", title: "Success: repeat visit", who: "Customer", note: "Thanks for coming back." },
  // Recommendations
  { id: "intro", title: "Friend's recommendation", who: "Customer", note: "Ana vouched for Lena's café. Reward locked in. Save with Face ID." },
  { id: "intro-accepted", title: "Recommendation saved", who: "Customer", note: "What happens next time." },
  { id: "intro-expired", title: "Recommendation expired", who: "Customer", note: "Ask Ana for a fresh link." },
  { id: "intro-already-customer", title: "Recommendation: already a customer", who: "Customer", note: "First-visit only, explained kindly." },
  { id: "recommend", title: "Recommend / share", who: "Customer", note: "One friend (counts double) vs anyone; preview; make the link with Face ID." },
  { id: "recommend-link", title: "Recommend: link ready", who: "Customer", note: "QR of the link, share sheet, copy." },
  { id: "recommend-locked", title: "Recommend: locked", who: "Customer", note: "Buy once to vouch." },
  { id: "ambassador", title: "Ambassador record", who: "Customer", note: "Ana: 14 verified customers across 5 venues. Hers, portable, shareable." },
];
