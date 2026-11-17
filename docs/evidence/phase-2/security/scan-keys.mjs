// Reads `git log -p --all` on stdin. Extracts every 64-hex token, derives the secp256k1 address, compares with
// wallets.public.json and the well-known anvil/hardhat test keys. Never prints a key; prints only counts and locations.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const repo = '/Users/christiandizon/Desktop/ubc-2026';
const require = createRequire(repo + '/apps/api/package.json');
const { privateKeyToAddress } = require('viem/accounts');
const pub = JSON.parse(readFileSync(repo + '/packages/shared/src/wallets.public.json', 'utf8'));
const byAddr = new Map(Object.entries(pub).map(([k, v]) => [v.toLowerCase(), k]));
// anvil default account addresses #0-#9 (public test keys; informational only)
const anvil = new Set(['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266','0x70997970c51812dc3a010c7d01b50e0d17dc79c8','0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc','0x90f79bf6eb2c4f870365e785982e1f101e93b906','0x15d34aaf54267db7d7c367839aaf71a00a2c6a65','0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc','0x976ea74026e726554db657fa54763abd0c3a0aa9','0x14dc79964da2c08b23698b3d3cc7ca32193d9955','0x23618e81e3f5cdf7f54c3d65f7fbc0abaed43b03','0xa0ee7a142d267c1f36714e4a8f75612f20a79720']);
const text = readFileSync(0, 'utf8');
let commit = '', file = '';
const seen = new Map(); // key -> {first: commit/file, added: bool}
const re = /(?<![0-9a-fA-Fx])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g;
let lines = 0;
for (const line of text.split('\n')) {
  lines++;
  if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (line.startsWith('diff --git')) continue;
  let m; re.lastIndex = 0;
  while ((m = re.exec(line))) {
    const k = m[1].toLowerCase();
    if (!seen.has(k)) seen.set(k, { commit, file });
  }
}
let derived = 0, invalid = 0; const hits = [], anvilHits = [];
for (const [k, loc] of seen) {
  let a;
  try { a = privateKeyToAddress('0x' + k).toLowerCase(); derived++; } catch { invalid++; continue; }
  if (byAddr.has(a)) hits.push({ role: byAddr.get(a), ...loc });
  if (anvil.has(a)) anvilHits.push({ addr: a, ...loc });
}
console.log(JSON.stringify({ linesScanned: lines, unique64hex: seen.size, derived, invalidScalars: invalid, projectKeyMatches: hits.length, hits, anvilTestKeyMatches: anvilHits.length, anvilHits }, null, 2));
