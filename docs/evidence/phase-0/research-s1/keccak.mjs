// Minimal keccak-256 (Ethereum variant, 0x01 padding) for offline verification.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M);
function f(s) {
  for (let r = 0; r < 24; r++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x][0] ^ s[x][1] ^ s[x][2] ^ s[x][3] ^ s[x][4]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) s[x][y] ^= D;
    }
    const B = [...Array(5)].map(() => Array(5).fill(0n));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rotl(s[x][y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & M & B[(x + 2) % 5][y]);
    s[0][0] ^= RC[r];
  }
}
export function keccak256(bytes) {
  const rate = 136;
  const msg = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  msg.set(bytes);
  msg[bytes.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const s = [...Array(5)].map(() => Array(5).fill(0n));
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
      s[i % 5][Math.floor(i / 5)] ^= lane;
    }
    f(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = s[i % 5][Math.floor(i / 5)];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return '0x' + Buffer.from(out).toString('hex');
}
export const k = (str) => keccak256(new TextEncoder().encode(str));
export const kHex = (hex) => keccak256(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
