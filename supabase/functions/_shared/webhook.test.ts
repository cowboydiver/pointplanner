import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature, parseWebhookEvent, SYNC_EVENTS } from './webhook';

// Independently produce a valid `sha256=<hex>` header for a payload + secret, the
// same way GitHub does, so the verifier can be exercised end-to-end.
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

describe('verifyWebhookSignature', () => {
  const secret = 'top-secret';
  const body = JSON.stringify({ action: 'opened', repository: { id: 42 } });

  it('accepts a correctly-signed payload', async () => {
    const header = await sign(secret, body);
    expect(await verifyWebhookSignature(secret, body, header)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const header = await sign(secret, body);
    expect(await verifyWebhookSignature(secret, body + ' ', header)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const header = await sign('other', body);
    expect(await verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, 'deadbeef')).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('flags a sync-worthy event with a repo id', () => {
    const parsed = parseWebhookEvent('issues', { action: 'closed', repository: { id: 99 } });
    expect(parsed).toEqual({ repoId: 99, action: 'closed', shouldSync: true });
  });

  it('handles every SYNC_EVENTS type', () => {
    for (const ev of SYNC_EVENTS) {
      expect(parseWebhookEvent(ev, { repository: { id: 1 } }).shouldSync).toBe(true);
    }
  });

  it('does not sync for an unrelated event', () => {
    expect(parseWebhookEvent('push', { repository: { id: 1 } }).shouldSync).toBe(false);
  });

  it('does not sync when the repo id is absent', () => {
    const parsed = parseWebhookEvent('issues', { action: 'opened' });
    expect(parsed).toEqual({ repoId: null, action: 'opened', shouldSync: false });
  });

  it('tolerates a non-object body', () => {
    expect(parseWebhookEvent('issues', null)).toEqual({ repoId: null, action: null, shouldSync: false });
  });
});
