import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import entitlementModule from '../extension/src/services/entitlement-service.js';

const [privateKeyPath, plan = 'pro_lifetime', subject = 'customer'] = process.argv.slice(2);
if (!privateKeyPath || !['pro_lifetime', 'sync'].includes(plan)) {
  console.error('Usage: npm run license:issue -- <private-key-jwk.json> <pro_lifetime|sync> [customer-id]');
  process.exitCode = 1;
} else {
  const privateKeyJwk = JSON.parse(await readFile(privateKeyPath, 'utf8'));
  const privateKey = await webcrypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = new Date();
  const features = ['workspaces.unlimited', 'search.advanced', 'rules.enabled', 'templates.enabled'];
  if (plan === 'sync') features.push('sync.enabled');
  const payload = {
    plan, status: 'active', subject, issuedAt: now.toISOString(), features,
    limits: { 'workspaces.limit': 1000000, 'history.automatic': 1000000, 'history.days': 90, 'manualSnapshots.limit': 1000000, 'trash.days': 30 },
    ...(plan === 'sync' ? { expiresAt: new Date(now.setFullYear(now.getFullYear() + 1)).toISOString() } : {}),
  };
  console.log(await entitlementModule.encodeEntitlementToken(payload, privateKey, webcrypto.subtle));
}
