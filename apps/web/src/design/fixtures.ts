import { parseUsdc } from "@vouch/shared";
import type { MoneyGraphProps } from "@/components/ui/MoneyGraph";
import type { SplitPart } from "@/components/ui/SplitBreakdown";

/**
 * Canonical demo story (AGENTS/README.md). Used by /design and as default props in screen mocks.
 * Ben pays $12.00 at Lena's café; Ana (70%) and Priya (30%) recommended it; Marco introduced Ana
 * and Sofia introduced Priya (L2 names are design placeholders: the story leaves them unnamed).
 * Sum of parts == total exactly, in base units.
 */
export const STORY = {
  venue: { name: "Lena's café", short: "Lena's", rewardBps: 1500, minOrder: parseUsdc("5.00") },
  customer: { name: "Ben" },
  total: parseUsdc("12.00"),
  pool: parseUsdc("1.80"),
  parts: {
    venue: parseUsdc("10.20"),
    cashback: parseUsdc("0.45"),
    ana: parseUsdc("0.693"),
    priya: parseUsdc("0.297"),
    marco: parseUsdc("0.252"),
    sofia: parseUsdc("0.108"),
  },
  l1Total: parseUsdc("0.99"),
  l2Total: parseUsdc("0.36"),
} as const;

/** The six-way split of Ben's first $12.00 purchase, from Ben's point of view. */
export const STORY_SPLIT: SplitPart[] = [
  { id: "venue", label: "Lena's café", reason: "your order", amount: STORY.parts.venue, role: "venue" },
  { id: "you", label: "You", reason: "welcome cashback", amount: STORY.parts.cashback, role: "you" },
  { id: "ana", label: "Ana", reason: "recommended Lena's", amount: STORY.parts.ana, role: "referrer" },
  { id: "priya", label: "Priya", reason: "recommended Lena's", amount: STORY.parts.priya, role: "referrer" },
  { id: "marco", label: "Marco", reason: "brought Ana in", amount: STORY.parts.marco, role: "introducer" },
  { id: "sofia", label: "Sofia", reason: "brought Priya in", amount: STORY.parts.sofia, role: "introducer" },
];

/** The same payment as a money graph (Ben → Lena's, Ana → Marco, Priya → Sofia). */
export const STORY_GRAPH: Omit<MoneyGraphProps, "size"> = {
  venue: { name: STORY.venue.name, amount: STORY.parts.venue },
  customer: { name: "Ben", cashback: STORY.parts.cashback },
  total: STORY.total,
  referrers: [
    { name: "Ana", amount: STORY.parts.ana, introducer: { name: "Marco", amount: STORY.parts.marco } },
    { name: "Priya", amount: STORY.parts.priya, introducer: { name: "Sofia", amount: STORY.parts.sofia } },
  ],
};
