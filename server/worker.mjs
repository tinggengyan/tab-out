const encoder = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}

async function verifyWebhookSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return constantTimeEqual(expected, signature);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signEntitlement(payload, privateKeyJwk) {
  const key = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(body));
  return `${body}.${base64Url(signature)}`;
}

function json(data, status = 200, origin = '*') {
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type' } });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

export async function handleRequest(request, env, dependencies = {}) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);
  if (request.method === 'OPTIONS') return origin ? json({}, 204, origin) : json({ error: 'origin_not_allowed' }, 403);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
  if (url.pathname === '/webhooks/lemon' && request.method === 'POST') {
    if (!env.LEMON_WEBHOOK_SECRET) return json({ error: 'server_not_configured' }, 503);
    const body = await request.text();
    if (!await verifyWebhookSignature(body, request.headers.get('x-signature'), env.LEMON_WEBHOOK_SECRET)) return json({ error: 'invalid_signature' }, 401);
    let event;
    try { event = JSON.parse(body); } catch { return json({ error: 'invalid_json' }, 400); }
    const eventName = String(event?.meta?.event_name || '').slice(0, 64);
    const entityId = String(event?.data?.id || '').slice(0, 128);
    if (!eventName || !entityId) return json({ error: 'invalid_event' }, 400);
    if (env.LICENSE_STATE) {
      if (eventName === 'order_refunded') await env.LICENSE_STATE.put(`revoked:order:${entityId}`, '1');
      if (eventName === 'subscription_expired') await env.LICENSE_STATE.put(`revoked:subscription:${entityId}`, '1');
      const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(`${eventName}:${entityId}`)));
      await env.LICENSE_STATE.put(`event:${digest}`, JSON.stringify({ eventName, receivedAt: new Date().toISOString() }), { expirationTtl: 2592000 });
    }
    return json({ received: true });
  }
  if (url.pathname !== '/redeem' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (!origin) return json({ error: 'origin_not_allowed' }, 403);
  if (!env.LEMON_STORE_ID || !env.PRO_VARIANT_ID || !env.SYNC_VARIANT_ID || !env.ENTITLEMENT_PRIVATE_KEY_JWK) return json({ error: 'server_not_configured' }, 503, origin);

  let input;
  try { input = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, origin); }
  const licenseKey = String(input?.licenseKey || '').trim();
  const deviceId = String(input?.deviceId || '').trim().slice(0, 128);
  const instanceId = String(input?.instanceId || '').trim().slice(0, 128);
  if (!/^[a-z0-9-]{16,128}$/i.test(licenseKey) || !deviceId) return json({ error: 'invalid_request' }, 400, origin);

  const fetcher = dependencies.fetch || fetch;
  const form = instanceId
    ? new URLSearchParams({ license_key: licenseKey, instance_id: instanceId })
    : new URLSearchParams({ license_key: licenseKey, instance_name: `Tab Out ${deviceId}` });
  const response = await fetcher(`https://api.lemonsqueezy.com/v1/licenses/${instanceId ? 'validate' : 'activate'}`, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  });
  const activation = await response.json().catch(() => null);
  if (!response.ok || !(instanceId ? activation?.valid : activation?.activated)) return json({ error: 'license_rejected' }, 403, origin);
  if (String(activation.meta?.store_id) !== String(env.LEMON_STORE_ID)) return json({ error: 'wrong_store' }, 403, origin);
  if (env.LICENSE_STATE) {
    const orderId = String(activation.meta?.order_id || '');
    const subscriptionId = String(activation.meta?.subscription_id || '');
    if ((orderId && await env.LICENSE_STATE.get(`revoked:order:${orderId}`)) || (subscriptionId && await env.LICENSE_STATE.get(`revoked:subscription:${subscriptionId}`))) {
      return json({ error: 'license_revoked' }, 403, origin);
    }
  }

  const variantId = String(activation.meta?.variant_id || '');
  const plan = variantId === String(env.PRO_VARIANT_ID) ? 'pro_lifetime' : variantId === String(env.SYNC_VARIANT_ID) ? 'sync' : null;
  if (!plan) return json({ error: 'wrong_product' }, 403, origin);
  const issuedAt = new Date().toISOString();
  const features = ['workspaces.unlimited', 'search.advanced', 'rules.enabled', 'templates.enabled'];
  if (plan === 'sync') features.push('sync.enabled');
  const payload = {
    plan, status: 'active', subject: `license:${activation.license_key.id}`, issuedAt, features,
    limits: { 'workspaces.limit': 1000000, 'history.automatic': 1000000, 'history.days': 90, 'manualSnapshots.limit': 1000000, 'trash.days': 30 },
    ...(plan === 'sync' && activation.license_key.expires_at ? { expiresAt: activation.license_key.expires_at } : {}),
  };
  const privateKey = JSON.parse(env.ENTITLEMENT_PRIVATE_KEY_JWK);
  return json({ token: await signEntitlement(payload, privateKey), plan, instanceId: activation.instance?.id || instanceId }, 200, origin);
}

export default { fetch: handleRequest };
export { verifyWebhookSignature };
