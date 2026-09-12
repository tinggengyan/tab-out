'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createEntitlementService } = require('../../extension/src/services/entitlement-service.js');

function memoryStorage() { let state = {}; return { async get(key) { return { [key]: state[key] }; }, async set(update) { state = { ...state, ...update }; } }; }
function memoryKv() { const state = new Map(); return { async get(key) { return state.get(key) || null; }, async put(key, value) { state.set(key, value); }, inspect() { return state; } }; }

test('license worker validates store and variant then returns a verifiable offline token', async () => {
  const { handleRequest } = await import('../../server/worker.mjs');
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const env = { ALLOWED_ORIGINS: 'chrome-extension://test', LEMON_STORE_ID: '10', PRO_VARIANT_ID: '20', SYNC_VARIANT_ID: '30', ENTITLEMENT_PRIVATE_KEY_JWK: JSON.stringify(privateKey) };
  const request = new Request('https://license.example/redeem', { method: 'POST', headers: { origin: 'chrome-extension://test', 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: '12345678-1234-1234-1234-123456789abc', deviceId: 'device-1' }) });
  const response = await handleRequest(request, env, { fetch: async () => new Response(JSON.stringify({ activated: true, license_key: { id: 99, expires_at: null }, meta: { store_id: 10, variant_id: 20 } }), { status: 200 }) });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const service = createEntitlementService({ storage: memoryStorage(), publicKeyJwk: publicKey, subtle: webcrypto.subtle });
  assert.equal((await service.activate(token)).plan, 'pro_lifetime');
});

test('license worker rejects origins and licenses from another product', async () => {
  const { handleRequest } = await import('../../server/worker.mjs');
  const baseEnv = { ALLOWED_ORIGINS: 'chrome-extension://test', LEMON_STORE_ID: '10', PRO_VARIANT_ID: '20', SYNC_VARIANT_ID: '30', ENTITLEMENT_PRIVATE_KEY_JWK: '{}' };
  const denied = await handleRequest(new Request('https://license.example/redeem', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), baseEnv);
  assert.equal(denied.status, 403);
  const request = new Request('https://license.example/redeem', { method: 'POST', headers: { origin: 'chrome-extension://test', 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: '12345678-1234-1234-1234-123456789abc', deviceId: 'device-1' }) });
  const wrong = await handleRequest(request, baseEnv, { fetch: async () => new Response(JSON.stringify({ activated: true, license_key: { id: 1 }, meta: { store_id: 10, variant_id: 999 } }), { status: 200 }) });
  assert.equal(wrong.status, 403);
});

test('license worker validates an existing provider instance without consuming another activation', async () => {
  const { handleRequest } = await import('../../server/worker.mjs');
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const env = { ALLOWED_ORIGINS: 'chrome-extension://test', LEMON_STORE_ID: '10', PRO_VARIANT_ID: '20', SYNC_VARIANT_ID: '30', ENTITLEMENT_PRIVATE_KEY_JWK: JSON.stringify(privateKey) };
  let requestedUrl;
  const request = new Request('https://license.example/redeem', { method: 'POST', headers: { origin: 'chrome-extension://test', 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: '12345678-1234-1234-1234-123456789abc', deviceId: 'device-1', instanceId: 'instance-1' }) });
  const response = await handleRequest(request, env, { fetch: async url => {
    requestedUrl = url;
    return new Response(JSON.stringify({ valid: true, license_key: { id: 99 }, instance: { id: 'instance-1' }, meta: { store_id: 10, variant_id: 20 } }), { status: 200 });
  } });
  assert.match(requestedUrl, /\/licenses\/validate$/);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).instanceId, 'instance-1');
});

test('signed refund webhook creates a minimal revocation marker and blocks redemption', async () => {
  const { handleRequest } = await import('../../server/worker.mjs');
  const body = JSON.stringify({ meta: { event_name: 'order_refunded' }, data: { id: '42', attributes: { user_email: 'must-not-be-stored@example.com' } } });
  const secret = 'webhook-secret';
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('hex');
  const kv = memoryKv();
  const env = { ALLOWED_ORIGINS: 'chrome-extension://test', LEMON_STORE_ID: '10', PRO_VARIANT_ID: '20', SYNC_VARIANT_ID: '30', ENTITLEMENT_PRIVATE_KEY_JWK: '{}', LEMON_WEBHOOK_SECRET: secret, LICENSE_STATE: kv };
  const webhook = await handleRequest(new Request('https://license.example/webhooks/lemon', { method: 'POST', headers: { 'x-signature': signature }, body } ), env);
  assert.equal(webhook.status, 200);
  assert.equal(await kv.get('revoked:order:42'), '1');
  assert.equal([...kv.inspect().values()].some(value => String(value).includes('must-not-be-stored')), false);

  const redemption = await handleRequest(new Request('https://license.example/redeem', { method: 'POST', headers: { origin: 'chrome-extension://test', 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: '12345678-1234-1234-1234-123456789abc', deviceId: 'device-1' }) }), env, {
    fetch: async () => new Response(JSON.stringify({ activated: true, license_key: { id: 99 }, meta: { store_id: 10, variant_id: 20, order_id: 42 } }), { status: 200 }),
  });
  assert.equal(redemption.status, 403);
  assert.equal((await redemption.json()).error, 'license_revoked');
});

test('webhook rejects an invalid signature without changing license state', async () => {
  const { handleRequest } = await import('../../server/worker.mjs');
  const kv = memoryKv();
  const response = await handleRequest(new Request('https://license.example/webhooks/lemon', { method: 'POST', headers: { 'x-signature': '00' }, body: '{}' }), { LEMON_WEBHOOK_SECRET: 'secret', LICENSE_STATE: kv });
  assert.equal(response.status, 401);
  assert.equal(kv.inspect().size, 0);
});
