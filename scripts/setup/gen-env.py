#!/usr/bin/env python3
"""Create the root .env from .env.example with freshly generated keys.

Run from the repo root:  python3 scripts/setup/gen-env.py
- Refuses to overwrite an existing .env.
- Writes private keys ONLY to .env (mode 600, gitignored). Prints public addresses only.
"""
import json, os, secrets, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENV, EXAMPLE = os.path.join(ROOT, ".env"), os.path.join(ROOT, ".env.example")
CAST = shutil.which("cast") or os.path.expanduser("~/.foundry/bin/cast")

KEYS = ["DEPLOYER", "RELAYER", "ATTRIBUTOR", "VENUE_SIGNER", "SPIKE_USER",
        "DEMO_LENA", "DEMO_ANA", "DEMO_BEN", "DEMO_PRIYA"]

if os.path.exists(ENV):
    sys.exit(".env already exists — refusing to overwrite. Delete it yourself if you really want new keys.")

s = open(EXAMPLE).read()
s = s.replace("# Copy to `.env` (root, gitignored) and fill in. NEVER commit real values.",
              "# REAL LOCAL SECRETS — gitignored. Never commit, never paste into chat.")
s = s.replace("SESSION_SECRET=__session_secret__", "SESSION_SECRET=" + secrets.token_hex(32))
extra, addrs = "\n# --- Demo personas (CLI/seed scripts) ---\n", {}
for n in KEYS:
    w = json.loads(subprocess.check_output([CAST, "wallet", "new", "--json"]))
    if isinstance(w, dict) and "data" in w:  # foundry >= 1.9 envelope: {schema_version, success, data: [...]}
        w = w["data"]
    w = w[0] if isinstance(w, list) else w
    addrs[n] = w["address"]
    placeholder = f"{n}_PRIVATE_KEY=0x__{n.lower()}_key__"
    line = f"{n}_PRIVATE_KEY={w['private_key']}"
    s = s.replace(placeholder, line) if placeholder in s else s
    if placeholder not in open(EXAMPLE).read():
        extra += line + "\n"
s += extra + "\n# --- Public addresses (safe to share) ---\n"
s += "".join(f"{n}_ADDRESS={a}\n" for n, a in addrs.items())

fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, s.encode()); os.close(fd)

# Public addresses also go to a committed, non-secret file so agents can read them.
pub = os.path.join(ROOT, "packages", "shared", "src", "wallets.public.json")
with open(pub, "w") as f:
    json.dump(addrs, f, indent=2); f.write("\n")

print("Wrote .env (600). Public addresses (also in packages/shared/src/wallets.public.json):")
for n, a in addrs.items():
    print(f"  {n:13s} {a}")
