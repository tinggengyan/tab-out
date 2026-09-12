'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createEntitlementService, encodeEntitlementToken } = require('../../extension/src/services/entitlement-service.js');

function memoryStorage(initial = {}) {
  let state = structuredClone(initial);
  return {
    async get(key) { return { [key]: structuredClone(state[key]) }; },
    async set(update) { state = { ...state, ...structuredClone(update) }; },
  };
}

async function signedToken(payload) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeyJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const token = await encodeEntitlementToken(payload, pair.privateKey, webcrypto.subtle);
  return { token, publicKeyJwk };
}

test('valid lifetime entitlement unlocks declared features offline', async () => {
  const { token, publicKeyJwk } = await signedToken({
    plan: 'pro_lifetime', status: 'active', issuedAt: '2026-08-01T00:00:00Z',
    features: ['workspaces.unlimited', 'history.90days'],
  });
  const service = createEntitlementService({ storage: memoryStorage(), publicKeyJwk, subtle: webcrypto.subtle });
  await service.activate(token);
  assert.equal(await service.has('workspaces.unlimited'), true);
  assert.equal((await service.current()).plan, 'pro_lifetime');
});

test('tampered entitlement is rejected and not stored', async () => {
  const { token, publicKeyJwk } = await signedToken({ plan: 'pro_lifetime', status: 'active', features: ['rules.enabled'] });
  const [body, signature] = token.split('.');
  const service = createEntitlementService({ storage: memoryStorage(), publicKeyJwk, subtle: webcrypto.subtle });
  await assert.rejects(() => service.activate(`${body.slice(0, -1)}x.${signature}`), /signature/i);
  assert.equal((await service.current()).plan, 'free');
});

test('sync entitlement enters grace for seven days then expires', async () => {
  const { token, publicKeyJwk } = await signedToken({
    plan: 'sync', status: 'active', issuedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-10T00:00:00Z', features: ['sync.enabled'],
  });
  const storage = memoryStorage();
  const active = createEntitlementService({ storage, publicKeyJwk, subtle: webcrypto.subtle, now: () => Date.parse('2026-08-15T00:00:00Z') });
  await active.activate(token);
  assert.equal((await active.current()).status, 'grace');
  assert.equal(await active.has('sync.enabled'), true);
  const expired = createEntitlementService({ storage, publicKeyJwk, subtle: webcrypto.subtle, now: () => Date.parse('2026-08-18T00:00:01Z') });
  assert.equal((await expired.current()).status, 'expired');
  assert.equal(await expired.has('sync.enabled'), false);
});

test('free entitlement exposes safe default limits', async () => {
  const service = createEntitlementService({ storage: memoryStorage() });
  assert.equal(await service.limit('workspaces.limit'), 3);
  assert.equal(await service.limit('history.automatic'), 3);
  assert.equal(await service.limit('manualSnapshots.limit'), 3);
  assert.equal(await service.limit('trash.days'), 7);
  assert.equal(await service.has('rules.enabled'), false);
});

test('refunded entitlement preserves local access but disables paid capabilities', async () => {
  const { token, publicKeyJwk } = await signedToken({
    plan: 'pro_lifetime', status: 'refunded', issuedAt: '2026-08-01T00:00:00Z', features: ['rules.enabled'],
  });
  const service = createEntitlementService({ storage: memoryStorage(), publicKeyJwk, subtle: webcrypto.subtle });
  await service.activate(token);
  assert.equal((await service.current()).status, 'refunded');
  assert.equal(await service.has('rules.enabled'), false);
  assert.equal(await service.limit('workspaces.limit'), 3);
});
