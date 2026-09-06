import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookFailureCode =
  | 'CONTENT_TYPE_INVALID'
  | 'PAYLOAD_TOO_LARGE'
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_INVALID'
  | 'TIMESTAMP_INVALID'
  | 'EVENT_STALE'
  | 'EVENT_REPLAYED'
  | 'PAYLOAD_MALFORMED'
  | 'EVENT_UNSUPPORTED';

export type WebhookVerification =
  { readonly accepted: true } | { readonly accepted: false; readonly code: WebhookFailureCode };

export interface ReplayStore {
  claim(provider: string, eventId: string, expiresAt: Date): Promise<boolean>;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly events = new Map<string, number>();

  async claim(provider: string, eventId: string, expiresAt: Date): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiry] of this.events) if (expiry <= now) this.events.delete(key);
    const key = `${provider}:${eventId}`;
    if (this.events.has(key)) return false;
    this.events.set(key, expiresAt.getTime());
    return true;
  }
}

export async function verifyHmacWebhook(input: {
  readonly provider: string;
  readonly eventId: string;
  readonly rawBody: Buffer;
  readonly contentType?: string;
  readonly signature?: string;
  readonly timestamp?: string;
  readonly secret: string;
  readonly replayStore: ReplayStore;
  readonly now?: Date;
  readonly maxAgeSeconds?: number;
  readonly maxBodyBytes?: number;
}): Promise<WebhookVerification> {
  if (!input.contentType?.toLowerCase().startsWith('application/json'))
    return { accepted: false, code: 'CONTENT_TYPE_INVALID' };
  if (input.rawBody.byteLength > (input.maxBodyBytes ?? 256 * 1024))
    return { accepted: false, code: 'PAYLOAD_TOO_LARGE' };
  if (!input.signature) return { accepted: false, code: 'SIGNATURE_MISSING' };
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return { accepted: false, code: 'TIMESTAMP_INVALID' };
  const now = input.now ?? new Date();
  const maxAgeSeconds = input.maxAgeSeconds ?? 300;
  if (Math.abs(now.getTime() / 1000 - timestamp) > maxAgeSeconds)
    return { accepted: false, code: 'EVENT_STALE' };
  const expected = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.`)
    .update(input.rawBody)
    .digest('hex');
  const supplied = input.signature.replace(/^sha256=/, '').toLowerCase();
  const valid =
    expected.length === supplied.length &&
    timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(supplied, 'utf8'));
  if (!valid) return { accepted: false, code: 'SIGNATURE_INVALID' };
  const claimed = await input.replayStore.claim(
    input.provider,
    input.eventId,
    new Date(now.getTime() + maxAgeSeconds * 1_000),
  );
  return claimed ? { accepted: true } : { accepted: false, code: 'EVENT_REPLAYED' };
}

export function parseVerifiedJsonWebhook<T extends { type?: unknown }>(
  rawBody: Buffer,
  supportedTypes: readonly string[],
):
  | { readonly accepted: true; readonly payload: T }
  | { readonly accepted: false; readonly code: WebhookFailureCode } {
  try {
    const payload = JSON.parse(rawBody.toString('utf8')) as T;
    if (typeof payload.type !== 'string' || !supportedTypes.includes(payload.type))
      return { accepted: false, code: 'EVENT_UNSUPPORTED' };
    return { accepted: true, payload };
  } catch {
    return { accepted: false, code: 'PAYLOAD_MALFORMED' };
  }
}
