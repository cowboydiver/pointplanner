import { describe, it, expect } from 'vitest';
import { createAppJwt, base64url, pemToPkcs8 } from './githubAuth';

// --- helpers ---------------------------------------------------------------

/** Wrap raw PKCS#8 DER bytes as a PEM string (what GitHub-style key files hold). */
function toPkcs8Pem(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

/** Decode a base64url segment to bytes. */
function b64urlToBytes(seg: string): Uint8Array {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson(seg: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

async function generateRsaPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

// --- tests -----------------------------------------------------------------

describe('base64url', () => {
  it('encodes a string url-safely without padding', () => {
    // "subjects?" → contains bytes that map to + / = in standard base64.
    expect(base64url('subjects?_d')).toBe('c3ViamVjdHM_X2Q');
    expect(base64url('')).toBe('');
  });

  it('produces no +, /, or = characters', () => {
    const out = base64url('ÿþýüû');
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe('pemToPkcs8', () => {
  it('round-trips PKCS#8 PEM back to the exact DER bytes', async () => {
    const pair = await generateRsaPair();
    const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const pem = toPkcs8Pem(der);
    expect(new Uint8Array(pemToPkcs8(pem))).toEqual(new Uint8Array(der));
  });
});

describe('createAppJwt', () => {
  const APP_ID = '123456';
  const NOW_MS = 1_700_000_000_000;
  const now = Math.floor(NOW_MS / 1000);

  it('builds an RS256 JWT with backdated iat, +9min exp, and the App id as iss', async () => {
    const pair = await generateRsaPair();
    const pem = toPkcs8Pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

    const jwt = await createAppJwt(APP_ID, pem, NOW_MS);
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    expect(jwt.split('.')).toHaveLength(3);

    expect(decodeJson(headerSeg)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeJson(payloadSeg)).toEqual({ iat: now - 30, exp: now + 540, iss: APP_ID });

    // The signature must verify against the public key over `header.payload`.
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pair.publicKey,
      b64urlToBytes(sigSeg),
      new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
    );
    expect(ok).toBe(true);
  });

  it('does not verify against a different key', async () => {
    const signer = await generateRsaPair();
    const other = await generateRsaPair();
    const pem = toPkcs8Pem(await crypto.subtle.exportKey('pkcs8', signer.privateKey));

    const jwt = await createAppJwt(APP_ID, pem, NOW_MS);
    const [h, p, s] = jwt.split('.');
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      other.publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(false);
  });
});
