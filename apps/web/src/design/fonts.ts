import { Instrument_Sans } from "next/font/google";

/**
 * The one sans family: Instrument Sans (variable weight 400–700 + width axis).
 * Why: a modern grotesque with slightly narrow, warm proportions. It reads as precise (fintech)
 * without the default-template feel of Inter/Geist, keeps large amounts compact at 390px, and
 * ships true tabular figures (OpenType `tnum`) for money. See docs/design/DESIGN_SYSTEM.md.
 * Exposed as the CSS variable --font-instrument, consumed by --font-sans in tokens.css.
 */
export const fontSans = Instrument_Sans({
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
  display: "swap",
  variable: "--font-instrument",
});
