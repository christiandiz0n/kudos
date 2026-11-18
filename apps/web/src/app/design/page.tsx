import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "@vouch/shared";
import { MoneyGraph, SplitBreakdown } from "@/components/ui";
import { CONTRAST_PAIRS, DARK_SELECTOR, LIGHT_SELECTOR, contrast, parsePalette } from "@/design/contrast";
import { STORY, STORY_GRAPH, STORY_SPLIT } from "@/design/fixtures";
import { SCREENS } from "./_mocks/meta";
import { PhoneFrame } from "./_mocks/PhoneFrame";
import { MotionDemo, Playground } from "./_mocks/Playground";
import { ScreenMock } from "./_mocks/ScreenMock";

export const metadata: Metadata = { title: `${APP_NAME} · Design system` };

const css = readFileSync(join(process.cwd(), "src/design/tokens.css"), "utf8");
const LIGHT = parsePalette(css, LIGHT_SELECTOR);
const DARK = parsePalette(css, DARK_SELECTOR);

function Section({ id, n, title, intro, children }: { id: string; n: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-shot={id} className="scroll-mt-6 border-t border-line px-4 py-12 sm:px-8">
      <div className="mx-auto max-w-[1320px]">
        <p className="money text-caption font-semibold text-accent-ink">{n}</p>
        <h2 className="mt-1 text-title-1 text-ink">{title}</h2>
        {intro ? <div className="mt-2 max-w-[68ch] text-body text-ink-2">{intro}</div> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

const SWATCHES: Array<[string, string]> = [
  ["canvas", "App background"],
  ["surface", "Cards, sheets"],
  ["surface-2", "Wells, tracks"],
  ["line", "Hairlines"],
  ["line-strong", "Input borders"],
  ["ink", "Text, primary button"],
  ["ink-2", "Secondary text"],
  ["ink-3", "Meta, captions"],
  ["accent", "Money to people"],
  ["accent-ink", "Green text"],
  ["accent-soft", "Green tint"],
  ["warning", "Expiring"],
  ["danger", "Errors only"],
];

const TYPE: Array<[string, string, string]> = [
  ["text-display", "Display · 52/54 · 600 · −3.5%", "$38.45"],
  ["text-title-1", "Title 1 · 28/32 · 600", "Pay local. Thank the friends who sent you."],
  ["text-title-2", "Title 2 · 22/28 · 600", "Recommend Lena's café"],
  ["text-title-3", "Title 3 · 18/24 · 600", "Confirm payment"],
  ["text-body", "Body · 16/24 · 400", "Your first visit gives you money back, and pays the people who sent you."],
  ["text-body-sm", "Body small · 14/20", "Who sent you here? Optional."],
  ["text-caption", "Caption · 13/18", "Today, 9:41 · first visit"],
];

const SPACING = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

export default function DesignPage() {
  return (
    <div className="bg-canvas text-ink">
      {/* Hero */}
      <header data-shot="direction" className="px-4 pt-10 pb-12 sm:px-8">
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <p className="text-body-sm font-semibold text-ink-2">{APP_NAME} design system · v0 · Phase 1 draft for approval</p>
            <h1 className="mt-3 max-w-[18ch] text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[3.5rem]">
              Ink and paper. Green means somebody got paid.
            </h1>
            <div className="mt-5 max-w-[60ch] space-y-3 text-body text-ink-2">
              <p>
                Clean fintech, set in a neighbourhood. Warm paper neutrals and ink-black actions keep it calm and trustworthy.
                There is one accent, a deep green, and it is reserved for money moving to a person: cashback, rewards, the
                referral flow, success. Primary buttons are ink, not green, so the green always carries meaning.
              </p>
              <p>
                <strong className="text-ink">Signature motif: the split receipt.</strong> Every payment is a perforated receipt
                whose total splits into the venue&apos;s share and a reward slice, and a loupe magnifies that slice into the faces
                of the people who made the sale happen. It shows up in the pay sheet, the success screen, venue onboarding and
                the public transparency page.
              </p>
              <p>
                Type is <strong className="text-ink">Instrument Sans</strong>, one family, tabular figures for every amount.
                Money is always dollars. Technical words live only in a collapsed &ldquo;Details&rdquo; drawer and on the
                transparency page.
              </p>
            </div>
            <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2 text-body-sm">
              {[
                ["color", "Color"],
                ["type", "Type"],
                ["layout", "Space · radius · elevation · motion"],
                ["components", "Components"],
                ["screens", "Screens"],
                ["dark", "Dark"],
                ["money-graph", "Money graph"],
                ["copy", "Copy"],
              ].map(([id, label]) => (
                <a key={id} href={`#${id}`} className="focus-ring inline-flex h-10 items-center rounded-full bg-surface px-4 font-medium text-ink ring-1 ring-line hover:bg-surface-2">
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <SplitBreakdown total={STORY.total} parts={STORY_SPLIT} highlightId="you" title="Ben's first $12.00 at Lena's café" />
        </div>
      </header>

      <Section id="color" n="01" title="Color" intro={<p>Light and dark are both first-class. All text pairs below are checked live against WCAG 2.2 AA from <code className="font-mono text-body-sm">src/design/tokens.css</code>.</p>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map(([name, use]) => (
            <div key={name} className="overflow-hidden rounded-md bg-surface ring-1 ring-line">
              <div className="grid h-16 grid-cols-2">
                <div data-theme="light" className="flex items-end p-1.5" style={{ background: `var(--vx-${name})` }} />
                <div data-theme="dark" className="flex items-end p-1.5" style={{ background: `var(--vx-${name})` }} />
              </div>
              <div className="p-2.5">
                <p className="text-caption font-semibold text-ink">{name}</p>
                <p className="text-micro font-medium tracking-normal text-ink-3">{use}</p>
                <p className="money mt-1 font-mono text-[0.6875rem] text-ink-2">
                  {LIGHT[name]} · {DARK[name]}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 overflow-x-auto rounded-lg bg-surface ring-1 ring-line">
          <table className="w-full min-w-[560px] text-left text-body-sm">
            <caption className="sr-only">Contrast ratios</caption>
            <thead className="text-caption text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Pair</th>
                <th className="px-4 py-2.5 font-semibold">Usage</th>
                <th className="px-4 py-2.5 font-semibold">Min</th>
                <th className="px-4 py-2.5 font-semibold">Light</th>
                <th className="px-4 py-2.5 font-semibold">Dark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {CONTRAST_PAIRS.map(([fg, bg, min, use]) => (
                <tr key={fg + bg}>
                  <td className="px-4 py-2 font-mono text-caption">
                    {fg} / {bg}
                  </td>
                  <td className="px-4 py-2 text-ink-2">{use}</td>
                  <td className="money px-4 py-2 text-ink-3">{min}:1</td>
                  {[LIGHT, DARK].map((pal, i) => {
                    const r = pal[fg] && pal[bg] ? contrast(pal[fg], pal[bg]) : 0;
                    return (
                      <td key={i} className={`money px-4 py-2 font-semibold ${r >= min ? "text-ink" : "text-danger-ink"}`}>
                        {r.toFixed(2)}:1 {r >= min ? "✓" : "✗"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="type" n="02" title="Type" intro={<p>Instrument Sans (variable, 400–700): a precise grotesque with slightly narrow, warm proportions. It keeps big amounts compact at 390px and has true tabular figures.</p>}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
          <div className="divide-y divide-line rounded-lg bg-surface px-5 ring-1 ring-line">
            {TYPE.map(([cls, spec, sample]) => (
              <div key={cls} className="py-4">
                <p className="text-caption text-ink-3">{spec}</p>
                <p className={`${cls} ${cls === "text-display" ? "money" : ""} text-ink`}>{sample}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
            <p className="text-body-sm font-semibold text-ink">Money is always tabular</p>
            <p className="text-caption text-ink-3">The `money` utility sets tnum + lnum, so columns of amounts line up.</p>
            <div className="mt-4 grid grid-cols-2 gap-6">
              <div>
                <p className="text-micro tracking-normal text-ink-3">money (tabular)</p>
                {["$10.20", "$0.45", "$0.69", "$0.30", "$0.25", "$0.11", "$12.00"].map((v) => (
                  <p key={v} className="money text-right text-title-3 text-ink">{v}</p>
                ))}
              </div>
              <div>
                <p className="text-micro tracking-normal text-ink-3">default (proportional)</p>
                {["$10.20", "$0.45", "$0.69", "$0.30", "$0.25", "$0.11", "$12.00"].map((v) => (
                  <p key={v} className="text-right text-title-3 text-ink-3 [font-variant-numeric:proportional-nums]">{v}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="layout" n="03" title="Space · radius · elevation · motion" intro={<p>4px base grid, 20px screen gutter, 48px minimum tap target (64px on the counter keypad). Motion is short and eased out; under <code className="font-mono text-body-sm">prefers-reduced-motion</code> every duration collapses to ~0 and the money-graph flow stops.</p>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
            <p className="mb-3 text-body-sm font-semibold">Spacing</p>
            {SPACING.map((s) => (
              <div key={s} className="flex items-center gap-3 py-1">
                <span className="money w-10 text-caption text-ink-3">{s}</span>
                <span className="h-3 rounded-xs bg-accent-3" style={{ width: s * 3 }} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-6">
            <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
              <p className="mb-3 text-body-sm font-semibold">Radius</p>
              <div className="flex flex-wrap gap-3">
                {[["xs", "6"], ["sm", "10"], ["md", "14"], ["lg", "20"], ["xl", "28"]].map(([k, v]) => (
                  <div key={k} className="flex flex-col items-center gap-1">
                    <span className="size-14 bg-surface-3" style={{ borderRadius: `var(--radius-${k})` }} />
                    <span className="text-caption text-ink-3">
                      {k} · {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-surface-2 p-5">
              <p className="mb-3 text-body-sm font-semibold">Elevation</p>
              <div className="grid grid-cols-3 gap-3">
                {["shadow-1", "shadow-2", "shadow-3"].map((s) => (
                  <div key={s} className={`flex h-16 items-center justify-center rounded-md bg-surface text-caption text-ink-3 ${s}`}>
                    {s}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
              <p className="mb-1 text-body-sm font-semibold">Motion</p>
              <p className="mb-3 text-caption text-ink-3">instant 90 · fast 160 · base 240 · slow 360 · celebrate 640 · flow 2400ms. ease-out (0.2, 0.8, 0.2, 1), spring (0.34, 1.56, 0.64, 1).</p>
              <MotionDemo />
            </div>
          </div>
        </div>
      </Section>

      <Section id="components" n="04" title="Components" intro={<p>Props-only, in <code className="font-mono text-body-sm">src/components/ui</code>. Tab through this section: every control has a visible focus ring.</p>}>
        <Playground />
      </Section>

      <Section id="screens" n="05" title="Screens at 390px" intro={<p>Low-fi layouts built from the real components with the canonical story. These are drafts for direction approval; Phase 3 makes them hi-fi. Each opens full screen for testing on a phone.</p>}>
        <div className="grid grid-cols-1 justify-items-center gap-x-8 gap-y-12 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {SCREENS.filter((s) => !s.desktop).map((s) => (
            <PhoneFrame key={s.id} id={s.id} title={s.title} who={s.who} note={s.note}>
              <ScreenMock id={s.id} />
            </PhoneFrame>
          ))}
        </div>
      </Section>

      <Section id="dark" n="06" title="Dark" intro={<p>Same components, re-tuned tokens. Follows the OS, or force it with <code className="font-mono text-body-sm">data-theme=&quot;dark&quot;</code>.</p>}>
        <div data-theme="dark" className="rounded-xl bg-canvas p-4 sm:p-8">
          <div className="grid grid-cols-1 justify-items-center gap-8 md:grid-cols-2 xl:grid-cols-3">
            {["wallet", "pay-confirm", "success"].map((id) => {
              const s = SCREENS.find((x) => x.id === id)!;
              return (
                <PhoneFrame key={id} id={id} title={s.title} who={s.who} note="Dark theme">
                  <ScreenMock id={id} />
                </PhoneFrame>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        id="money-graph"
        n="07"
        title="Money graph"
        intro={
          <p>
            v1 (Phase 3). One payment, drawn as money leaving Ben&apos;s purchase: the neutral stream to the venue on the left,
            green streams up the recommendation chain on the right (Ben → Ana → Marco, Ben → Priya → Sofia). Cashback is a
            &ldquo;+$0.45 back&rdquo; badge on Ben, never a loop. Edge width ∝ √amount. Seeded 5 / 20 / 60-person networks live in
            the <a href="/design/money-graph" className="font-semibold text-accent-ink underline underline-offset-4">money graph playground</a>.
          </p>
        }
      >
        <div className="rounded-xl bg-surface p-4 shadow-1 ring-1 ring-line sm:p-8" data-shot-desktop="money-graph-projector">
          <MoneyGraph {...STORY_GRAPH} size="projector" className="h-auto w-full" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
          <div className="rounded-lg bg-surface p-3 ring-1 ring-line">
            <MoneyGraph {...STORY_GRAPH} size="compact" className="h-auto w-full" />
            <p className="px-2 pt-1 text-caption text-ink-3">Compact (phone card)</p>
          </div>
          <div className="space-y-4 text-body text-ink-2">
            <h3 className="text-title-3 text-ink">Behavior at scale (v1)</h3>
            <p>
              <strong className="text-ink">Layout:</strong> fixed columns, no physics: venue ← customers → recommenders →
              introducers (rows top to bottom on a phone). People in the highlighted payment sit in the column of their role in it,
              so the story always reads left to right; everyone else sits in the highest tier they were paid in.
            </p>
            <p>
              <strong className="text-ink">Arrival:</strong> the customer pops in, the venue stream draws, the cashback badge lands,
              then recommenders and introducers in order (140ms stagger). Each person pings as money arrives; dashes run toward them
              for about 3s, then settle. Replays on every new payment id. Reduced motion shows the final frame.
            </p>
            <p>
              <strong className="text-ink">20 / 60 people:</strong> network view, cumulative edges per pair, history in pale
              green/grey, the latest payment in full colour. At most 7 per column on a projector (4 per row on a phone); the tail
              folds into one &ldquo;N more&rdquo; node per column, and highlighted people are always kept.
            </p>
          </div>
        </div>
      </Section>

      <Section id="copy" n="08" title="Copy" intro={<p>Full guide: <code className="font-mono text-body-sm">src/design/COPY.md</code>.</p>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
            <p className="text-body-sm font-semibold">Voice</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-ink-2">
              <li>Warm, plain, short. Like the person behind the counter, not a bank.</li>
              <li>Say who and how much: &ldquo;Ana got $0.69 for sending you&rdquo;.</li>
              <li>Dollars only, always two decimals on primary screens.</li>
              <li>Sentence case. No exclamation marks except on success, and only one.</li>
            </ul>
          </div>
          <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-line">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-line text-caption text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-semibold">Never on primary screens</th>
                  <th className="px-4 py-2 font-semibold">Say instead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  ["USDC, tokens, crypto", "dollars, $12.00"],
                  ["gas, gas fee", "(nothing; we cover it) · Details: “Network fee, paid by Vouch”"],
                  ["wallet address, 0x…", "your account / your name"],
                  ["transaction hash, tx", "receipt · Details: “Receipt ID”"],
                  ["sign, signature", "confirm, approve, save"],
                  ["seed phrase, private key", "(never) · Face ID or fingerprint"],
                  ["blockchain, on-chain, smart contract", "public record · transparency page only"],
                  ["referral, referrer, L1/L2", "recommendation, recommended you, brought them in"],
                  ["intro, countersign", "recommendation, save Ana's recommendation"],
                ].map(([a, b]) => (
                  <tr key={a}>
                    <td className="px-4 py-2 text-ink">{a}</td>
                    <td className="px-4 py-2 text-ink-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}
