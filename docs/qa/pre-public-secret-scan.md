# Pre-public secret scan (full history + working trees)

- **Date:** 2026-11-20
- **Scope:** `christiandiz0n/vouch`. Covers every commit reachable from any ref (`main`, `ui-blue`, `origin/main`), the working tree at `/Users/christiandizon/Desktop/ubc-2026`, and the worktree at `/Users/christiandizon/Desktop/ubc-2026-ui-blue`.
- **Mode:** read-only. This file is the only write. No secret value appears here. Every value is redacted to its first 4 and last 4 characters.
- **Not read (by rule):** `.env`, plus the contents of `scripts/seed/.state/` and `e2e/phase5/.state/`. The only checks on those paths were ignore status and absence from history.

## Verdict: **CLEAN-with-notes**

History and both working trees hold no project private key, API token, session token, webhook secret or private RPC URL. Nothing has to be removed from history or rotated before the repo goes public. The notes below are housekeeping items: an uncommitted `.gitignore` line and the author email in commit metadata.

## Method and counts

`gitleaks` and `trufflehog` are not installed, so the scan used `git` plus two custom Python scanners. The scanners read every blob through `git cat-file --batch`, run more than 20 regexes on it, and redact every match as they record it.

| Item | Count |
|---|---|
| Commits scanned (`git rev-list --all`, re-run after new commits landed during the scan) | 63 |
| Refs on GitHub (`git ls-remote origin`) | `HEAD`, `refs/heads/main` only (`ui-blue` is local-only) |
| Distinct paths across all trees of all commits | 1,164 |
| Blob/path objects scanned | 1,619 (87.2 MB; 483 binary, all PNG plus one ICO) |
| Commit messages scanned | 63 (373 lines) |
| Unique 64-hex strings in history | 644 (640 are valid secp256k1 scalars) |
| Unique 0x addresses in history (comparison set) | 165 |
| Working-tree files scanned (untracked in main, plus modified/untracked in the ui-blue worktree) | 66 (final pass), 118 (first pass) |
| Ignored-but-present logs scanned (`docs/evidence/**/*.log`) | 5 |

### Commands (abridged)

```sh
# 1. sensitive filenames ever committed
for c in $(git rev-list --all); do git ls-tree -r --name-only $c; done | sort -u \
  | grep -Ei '(^|/)\.env|\.pem$|\.key$|keys\.json|\.state|\.vercel|\.railway|\.har$|\.zip$|\.db$|\.bak$'
git log --all --oneline -- scripts/seed/.state e2e/phase5/.state .vercel .railway
git check-ignore -v scripts/seed/.state/x e2e/phase5/.state/x .vercel/x
# 2/3. all blobs: regex scan (QuickNode URLs, JWT, ghp_/gho_/github_pat_, npm_, sk-, AKIA, AIza, xox*,
#      Bearer/Authorization/Cookie literals, PEM, mnemonics, *_SECRET/*_KEY/*_TOKEN assignments,
#      provider RPC URLs, DB URLs with creds, ?token= values, emails, phones) + 64-hex collection
python3 -I scan.py <repo> <out>            # git rev-list --all --objects | git cat-file --batch
python3 -I derive.py ...                    # cast wallet address --private-key <hex>  (hex never echoed)
python3 -I onchain.py ... https://rpc.testnet.arc.network   # eth_getTransactionCount + eth_getBalance
git grep -I -oE 'v1\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}' $(git rev-list --all)   # session tokens
git log --all --format='%ae%n%ce' | sort | uniq -c                                     # author emails
# 4. working trees
git status --porcelain --ignored         # both worktrees; scan.py --files on untracked/modified files
```

## Results by check

1. **Committed secret files:** none. The only env file ever committed is `.env.example`, which holds placeholders only (`0x__...ey__`, `__se...et__`) and public addresses. No `*.pem`, `*.key`, `keys.json`, `.vercel/`, `.railway/`, HAR, zip, trace or db file is in any commit. `scripts/seed/.state/` and `e2e/phase5/.state/` have never been committed (0 commits) and are both ignored now. See note N1.
2. **64-hex strings:** 644 unique values. By context: 359 tx/block hashes, 48 event topics or keccak values, 45 bytes32 order ids or nonces, and 186 other values (mostly ABI-padded log topics in `apps/api/src/streams/fixtures/*.json`, EIP-712 typehashes and secp256k1 curve constants). An address was derived from every valid one of the 640, with keys never printed:
   - **0 match** any of the 9 wallets in `packages/shared/src/wallets.public.json` (DEPLOYER, RELAYER, ATTRIBUTOR, VENUE_SIGNER, SPIKE_USER, DEMO_LENA/ANA/BEN/PRIYA).
   - **0 match** any of the other 165 addresses in the repo, which include the seed personas' public addresses that show up in evidence.
   - Every derived address was queried on Arc testnet (0 RPC errors). **17 have activity**, and all 17 come from publicly known constants, not from secrets: the Transfer and OwnershipTransferred topics, the EIP-2612 `PERMIT_TYPEHASH`, small integers such as 1, 3 and 0xf4240, a `0xabab…abab` test fixture, and three third-party log topics. Sweeper bots fund and drain these "weak key" addresses on every EVM chain. None of them is a project wallet. So no committed 64-hex value is the key of any wallet the project uses or funds.
   - **Anvil keys:** no anvil private key appears as a literal. Two scripts (`scripts/setup/topup-local.sh`, `scripts/spikes/s5-local.sh`) use the public anvil mnemonic, and both point at `127.0.0.1` only. Anvil accounts 0–9 do hold Arc testnet balances (for example, account 0 has nonce 10,811). Those funds belong to third parties, because these keys are public worldwide. The project never funds them and no project config uses them on Arc. INFO only.
3. **Token patterns:** no QuickNode endpoint token, no Streams API key or security token value, no real `STREAMS_WEBHOOK_SECRET` or `SESSION_SECRET`, no JWT, no GitHub, npm, `sk-`, AWS or Google token, no provider RPC URL, and no DB URL with real credentials. The only matches are placeholders and test fixtures (table below). **No captured session token** (`v1.eyJ…` format, `vouch_session=` cookie, `Bearer v1.`) exists anywhere in `docs/evidence/**` or the rest of history, so there is no live-token expiry risk. No `Authorization` or `Cookie` header values appear in the NDJSON evidence. The `x-qn-signature` values in `docs/evidence/phase-0/qe/s3-hmac-e2e.ndjson` are HMACs made with the local test secret `qe-t...cret` (see `s3-hmac-e2e.txt`), not the production webhook secret.
4. **Working trees:** in main, nothing untracked contains secrets. The untracked items are `docs/evidence/phase-5/prod/p4/`, `docs/evidence/phase-5/prod/story/` and `e2e/phase5/p4-stage.mjs`. In the ui-blue worktree, the modified files and the untracked `apps/web/.c-shots.tmp.mjs` and `docs/evidence/ui-blue/` are clean. The ignored items are `.env`, the two `.state/` directories, `contracts/broadcast/` and five `.log` files. The logs were scanned and are clean.
5. **Personal info:** see note N2. The only emails in file content are test fixtures. No phone numbers or public IP addresses were found. Home paths (`/Users/christiandizon`) appear in 6 files, which is acceptable.

## Findings

| # | Severity | Redacted value | Path | Commit (first seen) | Recommendation |
|---|---|---|---|---|---|
| F1 | INFO | `test...cdef` (SESSION_SECRET test constant, 36 chars) | `apps/api/src/test/helpers.ts:32` | in history since Phase 2 (still at `cec7934`) | Test-only constant. Confirm the prod `SESSION_SECRET` in Railway is different (expected). |
| F2 | INFO | `qe-t...cret` (STREAMS_WEBHOOK_SECRET for local QE) | `AGENTS/QE_E2E.md`, `docs/evidence/phase-0/qe/s3-hmac-e2e.txt` | phase-0 QE commits | Local test value. Confirm prod differs (expected). |
| F3 | INFO | `exam...TKEY`, `abc....123/` (fake QuickNode URLs) | `apps/api/src/test/relayer.test.ts`, `apps/api/src/test/security.test.ts` | Phase 2 | Redaction test fixtures. None. |
| F4 | INFO | `v1.S...TMAC`, `v1.F...view`, `v1.a.b`, `v1.x.y` (`?token=` values) | `apps/api/src/test/security.test.ts` | Phase 2 | Fake session tokens in tests. None. |
| F5 | INFO | `post...:hu...@roundhouse.proxy.rlwy.net:12345` (`hunter2`) | `scripts/streams/filter.test.ts` | Phase 2/3 | Fake DB URL in a redaction test. None. |
| F6 | INFO | `MNEM...junk` (anvil default mnemonic) | `scripts/setup/topup-local.sh`, `scripts/spikes/s5-local.sh` | `755c3f4` / `c6eafcb` | Public key material, local anvil only. None. |
| F7 | INFO | 17 "weak" 64-hex constants (for example `ddf2...b3ef`, `8be0...57e0`, `0000...0001`) derive to active Arc addresses | `apps/api/src/streams/fixtures/v3-blocks.json`, `docs/evidence/phase-0/qe/*`, `docs/evidence/phase-3/qe/errors*.json` | various | Public constants (event topics, typehashes, small ints). Sweeper-bot addresses, not ours. None. |
| F8 | INFO | `cdf8...1181`, `f90d...3b02`, `d0f3...c817` (x-qn-signature) | `docs/evidence/phase-0/qe/s3-hmac-e2e.ndjson` | phase-0 QE | HMACs under a local test secret. None. |
| F9 | INFO | `eyJ2...MCJ9` (base64 JSON `{v,venue,id,amt}`) | `apps/web/src/app/design/_mocks/VenueMocks.tsx` | Phase 3 | Mock QR payload, not a JWT. None. |
| N1 | LOW (process) | `e2e/phase5/.state/` ignore rule | `.gitignore` (working tree, **uncommitted**) | not committed | The rule protecting the P4 persona and passkey state exists only as an uncommitted change. Commit the `.gitignore` change before anyone runs `git add -A` or `git add e2e/`. |
| N2 | LOW (privacy) | `chri...@gmail.com` | author/committer metadata on all commits | all | A personal Gmail address becomes public with the repo. Optional: rewrite authors to a GitHub noreply address (`git filter-repo --mailmap`, which needs a force-push), or accept it. It is not a secret. |
| N3 | INFO | `ui-blue` branch | local only | `cec7934` | Not on GitHub. Scan it again if it gets pushed after new commits. |

## Limitations

- PNG screenshots (541 paths) were not OCR'd. Their file names show app UI only, with no dashboard, devtools, settings or key-export screens.
- A key embedded inside a longer hex run (for example calldata) would not be picked up as a standalone 64-hex value. No key-like context points to that.
- The ignored local files (`.env`, `.state/`) were not inspected. They stay private as long as they remain ignored.
- New commits arrived during the scan (53 at the start, 63 at the end). The full history scan was re-run at 63 commits with identical findings. Re-run this scan if many more commits land before the repo goes public.
