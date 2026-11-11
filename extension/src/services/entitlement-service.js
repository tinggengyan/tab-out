(function initEntitlementService(globalScope) {
  'use strict';
  function toBase64Url(bytes) {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    const encoded = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  function encodeJson(value) { return toBase64Url(new TextEncoder().encode(JSON.stringify(value))); }
  function decodeJson(value) { return JSON.parse(new TextDecoder().decode(fromBase64Url(value))); }

  async function encodeEntitlementToken(payload, privateKey, subtle = globalScope.crypto.subtle) {
    const body = encodeJson(payload);
    const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(body));
    return `${body}.${toBase64Url(signature)}`;
  }

  function createEntitlementService(options = {}) {
    const storage = options.storage;
    if (!storage?.get || !storage?.set) throw new TypeError('A storage area is required');
    const subtle = options.subtle || globalScope.crypto?.subtle;
    const now = options.now || (() => Date.now());
    const key = options.key || 'entitlementV1';
    const free = { plan: 'free', status: 'active', features: [], limits: { 'workspaces.limit': Infinity, 'history.automatic': 3, 'history.days': 7, 'manualSnapshots.limit': 3, 'trash.days': 7 } };
    let importedPublicKey;

    async function publicKey() {
      if (!options.publicKeyJwk || !subtle) return null;
      if (!importedPublicKey) importedPublicKey = subtle.importKey('jwk', options.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return importedPublicKey;
    }
    async function verify(token) {
      const [body, signature, extra] = String(token || '').split('.');
      const verificationKey = await publicKey();
      if (!body || !signature || extra || !verificationKey) throw new Error('Invalid entitlement signature');
      let valid = false;
      try {
        valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verificationKey, fromBase64Url(signature), new TextEncoder().encode(body));
      } catch {}
      if (!valid) throw new Error('Invalid entitlement signature');
      const payload = decodeJson(body);
      if (!['pro_lifetime', 'sync'].includes(payload.plan) || !['active', 'refunded'].includes(payload.status) || !Array.isArray(payload.features)) throw new Error('Invalid entitlement payload');
      return payload;
    }
    function withStatus(payload) {
      if (payload.plan !== 'sync' || !payload.expiresAt) return payload;
      const expiry = Date.parse(payload.expiresAt);
      if (now() <= expiry) return payload;
      if (now() <= expiry + 7 * 86400000) return { ...payload, status: 'grace' };
      return { ...payload, status: 'expired' };
    }
    async function current() {
      const stored = await storage.get(key);
      if (!stored[key]?.token) return free;
      try { return withStatus(await verify(stored[key].token)); } catch { return free; }
    }
    return {
      async activate(token) {
        const payload = await verify(token);
        await storage.set({ [key]: { token, activatedAt: new Date(now()).toISOString() } });
        return withStatus(payload);
      },
      current,
      async has(feature) {
        const entitlement = await current();
        return ['active', 'grace'].includes(entitlement.status) && entitlement.features.includes(feature);
      },
      async limit(name) {
        if (name === 'workspaces.limit') return Infinity;
        const entitlement = await current();
        if (['active', 'grace'].includes(entitlement.status) && entitlement.limits?.[name] !== undefined) return entitlement.limits[name];
        if (['active', 'grace'].includes(entitlement.status) && entitlement.features.includes(`${name}.unlimited`)) return Infinity;
        return free.limits[name];
      },
      async deactivate() { await storage.set({ [key]: null }); },
    };
  }
  const api = { createEntitlementService, encodeEntitlementToken };
  globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
