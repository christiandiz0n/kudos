# P4 stage: the two-level chain for the demo video

`e2e/phase5/p4-stage.mjs` sets up VIDEO_SCRIPT prep step P4 with scripted personas. Then the only real phone in the shot is **Ben** (your iPhone).

## Commands (repo root)

```bash
# Build a fresh stage (headless, about 3 minutes). Refuses if a complete stage already exists; --force builds a new one.
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --build

# Headless readiness check: reopens the saved profiles + passkeys, checks them, screenshots verify-*.png.
# Opens no windows, never builds, spends nothing. Exit 0 = READY. Agents use only this one.
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --verify

# HUMAN ONLY, at recording time: open the stage (headed windows). Stays open until Ctrl+C.
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --present

# HUMAN ONLY: the same, but takes screenshots and closes after 20 s (also runs the headed automation-bar A/B)
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --present --check-seconds 20
```

Always pass `--base` exactly as written. zsh does not split a variable holding the flags, and without `--base` the script falls back to `localhost:3100`.

## What `--build` makes

- **Venue:** "Lena's Corner" at a 20% reward with a $0.50 minimum, owned by the scripted **Lena**.
- **Priya:** a fresh account, funded to $3 from DEPLOYER. She pays $1.00, a plain first purchase that makes her a verified customer.
- **Ana:** opens Priya's link and saves it, is funded to $3 from DEPLOYER, then pays $2.00. Priya is thanked $0.22, and Ana's introducer at this venue is now Priya.
- **Ben's link:** Ana → Recommend → Make my link.

The build checks on chain that both payments split exactly and that `introducerOf(venue, Ana) == Priya`. With that chain in place, Ben's live $2.00 pays both levels:

> pool $0.40 → **Ben $0.10 back · Ana $0.22 · Priya $0.08 · venue $1.60**

**Saved state** (gitignored, never commit), all under `e2e/phase5/.state/`:

| File | Holds |
|---|---|
| `p4.json` | addresses, Ben's link, tx hashes, checks |
| `profiles/<build>/` | the persistent Chromium profiles |
| `creds-<build>-*.json` | the virtual passkeys (CDP `WebAuthn.getCredentials`, re-added on reopen) |

The personas' passkeys have no PRF. That puts the app's wallet in "gated" mode, so a re-added passkey still unlocks it hours later.

**Never half-reused:**
- An interrupted build is moved aside and reported, together with what it spent.
- A failed build is kept as `failed-<build>.json`.
- The script prints exactly what it spent: DEPLOYER transfers and gas, plus relayer gas per tx.
- The in-app demo top-up is blocked in every build context, so it uses $0 of the $30/day cap.

## The windows (`--present`)

| Window | Shows | You do |
|---|---|---|
| **W1** owner (Lena), 1440×900 | Tab 1: the live dashboard and money graph. Tab 2: the **counter** keypad. | On tab 2, key **2.00** → **Show code**, then switch to tab 1 for the money graph. At this width the dashboard has no "Take an order" button once it has payments, so tab 2 stands in for it. |
| **W2** Ana, 390×844 | Ana's wallet | Nothing. Her "just arrived" toast pops when Ben pays. |
| **W3** | Ben's link as a big QR, with the URL underneath | Scan it with the iPhone camera → sign in as Ben → **Save Ana's recommendation** → **Top up (testnet demo)**. Then scan the counter QR and pay, picking **Ana**. |

The terminal prints Ben's link, the projector URL (`/venue/<venue>`, viewable by any signed-in browser) and the counter URL.

There is no "Chrome is being controlled by automated test software" bar. The script drops `--enable-automation` and adds `--test-type`, which also hides the "unsupported command-line flag" bar on the startup tab. `--check-seconds` measures this with an A/B of the page height.

## Fallback

`--present` checks the saved stage before opening it:
- the profile wallet is still there;
- the re-added passkey passes a real WebAuthn assertion;
- the api session works;
- the venue has exactly 2 payments, meaning Ben hasn't paid yet.

If anything fails, it prints why, runs `--build --force` automatically, and then opens the windows.

**Ben's link is a personal link.** Once Ben pays, the stage is used up, and the next `--present` builds a new venue. A new venue makes Ben a first-time customer again, so retakes still show the reward.

## Cost per build

| Item | Cost |
|---|---|
| DEPLOYER: Priya $3.00 + Ana $3.00 + about $0.0037 gas | about **$6.004** (Ana keeps about $1.10, Priya about $2.22) |
| Relayer gas: venue registration, Priya's pay, Ana's save, Ana's pay | about **$0.023** |
| In-app demo top-up cap | **$0** |

DEPLOYER held $25.00 after tonight's build, which is enough for about 3 more rebuilds (the CLI keeps a $5 reserve).
