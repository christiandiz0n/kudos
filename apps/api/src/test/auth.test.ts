import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToken, signToken, tokenFrom } from '../auth/session';
import { P, SESSION_SECRET, call, makeApp, signIn } from './helpers';

test('sign-in: EIP-191 challenge → session token → /auth/session → logout revokes', async () => {
  const t = await makeApp();
  try {
    const token = await signIn(t.app, P.ana, 'Ana');
    const s = await call(t.app, 'GET', '/auth/session', token);
    assert.equal(s.status, 200);
    assert.equal(s.body.address, P.ana.address);
    assert.equal(s.body.displayName, 'Ana');
    assert.equal(s.body.roles.venueOwner, false);
    assert.equal((await call(t.app, 'POST', '/auth/logout', token, {})).status, 200);
    const after = await call(t.app, 'GET', '/auth/session', token);
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'UNAUTHENTICATED');
  } finally {
    await t.close();
  }
});

test('sign-in: wrong signer → INVALID_SIGNATURE; challenge is single-use; address mismatch refused', async () => {
  const t = await makeApp();
  try {
    const ch = await call(t.app, 'POST', '/auth/challenge', undefined, { address: P.ana.address });
    assert.equal(ch.status, 200);
    assert.match(ch.body.message, /does not move any money/);
    assert.match(ch.body.message, new RegExp(P.ana.address));
    const bad = await call(t.app, 'POST', '/auth/verify', undefined, { address: P.ana.address, challengeId: ch.body.challengeId, signature: await P.eve.signMessage({ message: ch.body.message }) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_SIGNATURE');
    const good = await P.ana.signMessage({ message: ch.body.message });
    const other = await call(t.app, 'POST', '/auth/verify', undefined, { address: P.eve.address, challengeId: ch.body.challengeId, signature: good });
    assert.equal(other.status, 401, 'challenge bound to the address it was issued for');
    assert.equal((await call(t.app, 'POST', '/auth/verify', undefined, { address: P.ana.address, challengeId: ch.body.challengeId, signature: good })).status, 200);
    const replay = await call(t.app, 'POST', '/auth/verify', undefined, { address: P.ana.address, challengeId: ch.body.challengeId, signature: good });
    assert.equal(replay.status, 401);
  } finally {
    await t.close();
  }
});

test('protected endpoints: no token / forged token / bad body → 401 / 401 / 400', async () => {
  const t = await makeApp();
  try {
    assert.equal((await call(t.app, 'GET', '/me/wallet')).status, 401);
    const forged = signToken('not-the-secret', { sid: 'x', sub: P.ana.address, exp: Math.floor(Date.now() / 1000) + 60 });
    assert.equal((await call(t.app, 'GET', '/me/wallet', forged)).status, 401);
    // Valid MAC but unknown session row (e.g. a different DB) → refused.
    const orphan = signToken(SESSION_SECRET, { sid: 'nope', sub: P.ana.address, exp: Math.floor(Date.now() / 1000) + 60 });
    assert.equal((await call(t.app, 'GET', '/me/wallet', orphan)).status, 401);
    const r = await call(t.app, 'POST', '/auth/challenge', undefined, { address: 'not-an-address' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'BAD_REQUEST');
  } finally {
    await t.close();
  }
});

test('SESSION_SECRET unset → sign-in fails closed (503)', async () => {
  const t = await makeApp({ cfg: { sessionSecret: undefined } });
  try {
    const r = await call(t.app, 'POST', '/auth/challenge', undefined, { address: P.ana.address });
    assert.equal(r.status, 503);
  } finally {
    await t.close();
  }
});

test('token: MAC, expiry and transport (bearer, cookie, ?token=)', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const tok = signToken('s', { sid: 'a', sub: P.ben.address, exp });
  assert.equal(parseToken('s', tok)?.sub, P.ben.address);
  assert.equal(parseToken('t', tok), null);
  assert.equal(parseToken('s', tok, exp), null, 'expired at exp');
  assert.equal(parseToken('s', `${tok.slice(0, -2)}xx`), null);
  assert.equal(tokenFrom({ headers: { authorization: `Bearer ${tok}` } }), tok);
  assert.equal(tokenFrom({ headers: { cookie: `a=1; vouch_session=${encodeURIComponent(tok)}` } }), tok);
  assert.equal(tokenFrom({ headers: {}, query: { token: tok } }), tok);
});
