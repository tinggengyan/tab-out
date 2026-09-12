import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log(JSON.stringify({
  publicKeyJwk: publicKey.export({ format: 'jwk' }),
  privateKeyJwk: privateKey.export({ format: 'jwk' }),
}, null, 2));
