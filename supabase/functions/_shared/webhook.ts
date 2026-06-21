// Pure helpers for the github-webhook function: HMAC signature verification and
// event → repo-id parsing. Deliberately free of Deno/URL imports (only Web
// Crypto + plain parsing) so they run under the repo's vitest suite as well as
// Deno. See _shared/webhook.test.ts.

const encoder = new TextEncoder();

/** Lowercase hex of an ArrayBuffer. */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (equal length assumed by callers). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify GitHub's `X-Hub-Signature-256` header (format `sha256=<hex>`) against
 * the raw request body using the webhook secret. Returns false for a missing or
 * malformed header rather than throwing, so the caller can reply 401 uniformly.
 */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return timingSafeEqual(provided, toHex(mac));
}

/** GitHub webhook events that should trigger a re-sync of a mirror map. */
export const SYNC_EVENTS = new Set(['issues', 'milestone', 'sub_issue']);

export interface ParsedWebhook {
  /** Stable numeric repo id from the payload, or null if absent. */
  repoId: number | null;
  /** The event's `action` (e.g. 'opened', 'closed'), or null. */
  action: string | null;
  /** True when this event type warrants re-syncing the affected mirror(s). */
  shouldSync: boolean;
}

/**
 * Extract the repo id + action from a parsed webhook body and decide whether the
 * event warrants a re-sync. `eventName` is the `X-GitHub-Event` header. Tolerates
 * unknown/partial bodies — an unrecognized shape yields `{ repoId: null,
 * shouldSync: false }`.
 */
export function parseWebhookEvent(eventName: string | null | undefined, body: unknown): ParsedWebhook {
  const obj = (body ?? {}) as Record<string, unknown>;
  const repo = obj.repository as { id?: unknown } | undefined;
  const repoId = typeof repo?.id === 'number' ? repo.id : null;
  const action = typeof obj.action === 'string' ? obj.action : null;
  const shouldSync = Boolean(eventName && SYNC_EVENTS.has(eventName) && repoId !== null);
  return { repoId, action, shouldSync };
}
