import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import type {
  DeliveryReceipt,
  EmailMessage,
  LocalEmailCertificationProvider,
  LocalSmsCertificationProvider,
  OtpSmsMessage,
  OtpSmsProvider,
  SmsMessage,
  TransactionalEmailProvider,
} from './delivery.provider';
import { EmailProvider, SmsProvider } from './delivery.provider';
import { renderSmsMessage } from './delivery.provider';

const REQUEST_TIMEOUT_MS = 10_000;

export interface PostmarkRejectionDiagnostics {
  readonly httpStatus: number;
  readonly errorCode?: number;
  readonly reason: string;
  readonly providerRequestId?: string;
}

export class PostmarkProviderError extends Error {
  constructor(
    message: 'EMAIL_PROVIDER_REJECTED' | 'EMAIL_PROVIDER_RETRYABLE',
    readonly diagnostics: PostmarkRejectionDiagnostics,
  ) {
    super(message);
    this.name = 'PostmarkProviderError';
  }
}

export class DisabledEmailProvider extends EmailProvider {
  async send(): Promise<void> {
    throw new Error('Transactional email is disabled.');
  }
}

export class DisabledSmsProvider extends SmsProvider {
  async send(): Promise<void> {
    throw new Error('SMS delivery is disabled.');
  }
}

@Injectable()
export class PostmarkEmailProvider
  extends EmailProvider
  implements TransactionalEmailProvider, LocalEmailCertificationProvider
{
  constructor(private readonly configuration: ConfigService<ApiEnvironment, true>) {
    super();
  }

  async send(message: EmailMessage): Promise<void> {
    await this.sendTransactional(
      message,
      deliveryKey('email', message.to, message.template, message.token),
    );
  }

  async sendTransactional(message: EmailMessage, idempotencyKey: string): Promise<DeliveryReceipt> {
    return this.post(
      '/email/withTemplate',
      {
        From: this.configuration.getOrThrow('POSTMARK_FROM_EMAIL', { infer: true }),
        To: message.to,
        TemplateAlias: message.template.toLowerCase().replaceAll('_', '-'),
        MessageStream:
          this.configuration.get('POSTMARK_MESSAGE_STREAM', { infer: true }) ?? 'outbound',
        TemplateModel: { ...message.variables, action_url: message.actionUrl },
      },
      idempotencyKey,
    );
  }

  async sendCertification(to: string, idempotencyKey: string): Promise<DeliveryReceipt> {
    return this.post(
      '/email',
      {
        From: this.configuration.getOrThrow('POSTMARK_FROM_EMAIL', { infer: true }),
        To: to,
        Subject: 'CarShare Postmark local certification',
        TextBody:
          'CarShare transactional email delivery is configured correctly for local provider certification.',
        MessageStream:
          this.configuration.get('POSTMARK_MESSAGE_STREAM', { infer: true }) ?? 'outbound',
      },
      idempotencyKey,
    );
  }

  private async post(
    path: '/email' | '/email/withTemplate',
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<DeliveryReceipt> {
    const token = this.configuration.getOrThrow('POSTMARK_SERVER_TOKEN', { infer: true });
    const response = await fetch(`https://api.postmarkapp.com${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
        'X-CarShare-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as {
      MessageID?: string;
      ErrorCode?: number;
      Message?: string;
    };
    const providerRequestId = safePostmarkIdentifier(
      response.headers.get('X-Postmark-Request-Id') ?? body.MessageID,
    );
    if (!response.ok || body.ErrorCode)
      throw new PostmarkProviderError(
        response.status >= 500 || response.status === 429
          ? 'EMAIL_PROVIDER_RETRYABLE'
          : 'EMAIL_PROVIDER_REJECTED',
        {
          httpStatus: response.status,
          reason: sanitizePostmarkReason(body.Message),
          ...(Number.isInteger(body.ErrorCode) ? { errorCode: body.ErrorCode } : {}),
          ...(providerRequestId ? { providerRequestId } : {}),
        },
      );
    return {
      provider: 'postmark',
      providerMessageId: body.MessageID ?? idempotencyKey,
      status: 'ACCEPTED',
    };
  }
}

function sanitizePostmarkReason(message: string | undefined): string {
  if (!message) return 'Postmark rejected the request without a diagnostic message.';
  return message
    .replace(
      /[\w.!#$%&'*+/=?^`{|}~-]+@[\w](?:[\w-]{0,61}[\w])?(?:\.[\w](?:[\w-]{0,61}[\w])?)+/gu,
      '[redacted-email]',
    )
    .replace(/\b(?:bearer\s+)?[a-z0-9_-]{24,}\b/giu, '[redacted-credential]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 500);
}

function safePostmarkIdentifier(value: string | undefined): string | undefined {
  return value && /^[a-z0-9-]{8,100}$/iu.test(value) ? value : undefined;
}

@Injectable()
export class SemaphoreSmsProvider
  extends SmsProvider
  implements OtpSmsProvider, LocalSmsCertificationProvider
{
  constructor(private readonly configuration: ConfigService<ApiEnvironment, true>) {
    super();
  }

  async send(message: SmsMessage): Promise<void> {
    const secret = message.template === 'STAFF_INVITATION' ? message.invitationUrl : message.code;
    await this.post(
      renderSmsMessage(message),
      message.to,
      deliveryKey('sms', message.to, message.template, secret),
    );
  }

  async sendOtp(message: OtpSmsMessage, idempotencyKey: string): Promise<DeliveryReceipt> {
    return this.post(renderSmsMessage(message), message.to, idempotencyKey);
  }

  async sendCertification(to: string, idempotencyKey: string): Promise<DeliveryReceipt> {
    return this.post(
      'CarShare Semaphore local certification. SMS delivery is configured correctly.',
      to,
      idempotencyKey,
    );
  }

  private async post(
    message: string,
    to: string,
    idempotencyKey: string,
  ): Promise<DeliveryReceipt> {
    const form = new URLSearchParams({
      apikey: this.configuration.getOrThrow('SEMAPHORE_API_KEY', { infer: true }),
      number: to.replace(/^\+/, ''),
      message,
    });
    const sender = this.configuration.get('SEMAPHORE_SENDER_NAME', { infer: true });
    if (sender) form.set('sendername', sender);
    let response: Response;
    try {
      response = await fetch(
        this.configuration.get('SEMAPHORE_API_URL', { infer: true }) ??
          'https://api.semaphore.co/api/v4/messages',
        {
          method: 'POST',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CarShare-Idempotency-Key': idempotencyKey,
          },
          body: form,
        },
      );
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === 'TimeoutError';
      throw new SemaphoreProviderError('SMS_PROVIDER_RETRYABLE', {
        httpStatus: 0,
        providerCode: timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        reason: timeout ? 'Semaphore request timed out.' : 'Semaphore request failed.',
      });
    }
    const body = (await response.json().catch(() => undefined)) as
      SemaphoreResponseItem[] | SemaphoreErrorBody | undefined;
    const item = Array.isArray(body) ? body[0] : undefined;
    if (!response.ok) {
      throw new SemaphoreProviderError(
        response.status >= 500 || response.status === 429
          ? 'SMS_PROVIDER_RETRYABLE'
          : 'SMS_PROVIDER_REJECTED',
        semaphoreDiagnostics(response.status, body),
      );
    }
    if (!item?.message_id || typeof item.status !== 'string') {
      throw new SemaphoreProviderError('SMS_PROVIDER_REJECTED', {
        httpStatus: response.status,
        providerCode: 'MALFORMED_RESPONSE',
        reason: 'Semaphore returned an invalid acceptance response.',
      });
    }
    const status = normalizeSemaphoreStatus(item.status);
    if (status === 'FAILED' || status === 'UNKNOWN') {
      const providerCode = safeSemaphoreCode(item.status);
      const providerMessageId = safeSemaphoreIdentifier(item.message_id);
      throw new SemaphoreProviderError('SMS_PROVIDER_REJECTED', {
        httpStatus: response.status,
        reason: 'Semaphore did not accept the SMS for delivery.',
        ...(providerCode === undefined ? {} : { providerCode }),
        ...(providerMessageId ? { providerMessageId } : {}),
      });
    }
    return {
      provider: 'semaphore',
      providerMessageId: String(item.message_id),
      status,
    };
  }
}

interface SemaphoreResponseItem {
  readonly message_id?: string | number;
  readonly status?: string;
}

interface SemaphoreErrorBody {
  readonly code?: string | number;
  readonly error?: string;
  readonly message?: string;
  readonly status?: string | number;
}

export interface SemaphoreRejectionDiagnostics {
  readonly httpStatus: number;
  readonly providerCode?: string | number;
  readonly reason: string;
  readonly providerMessageId?: string;
}

export class SemaphoreProviderError extends Error {
  constructor(
    message: 'SMS_PROVIDER_REJECTED' | 'SMS_PROVIDER_RETRYABLE',
    readonly diagnostics: SemaphoreRejectionDiagnostics,
  ) {
    super(message);
    this.name = 'SemaphoreProviderError';
  }
}

function semaphoreDiagnostics(
  httpStatus: number,
  body: SemaphoreResponseItem[] | SemaphoreErrorBody | undefined,
): SemaphoreRejectionDiagnostics {
  const responseItem = Array.isArray(body) ? body[0] : undefined;
  const errorBody = !Array.isArray(body) ? body : undefined;
  const providerCode = safeSemaphoreCode(
    responseItem?.status ?? errorBody?.code ?? errorBody?.status,
  );
  const rawReason = errorBody?.message ?? errorBody?.error;
  const providerMessageId = safeSemaphoreIdentifier(responseItem?.message_id);
  return {
    httpStatus,
    reason: sanitizeSemaphoreReason(rawReason),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

function sanitizeSemaphoreReason(reason: string | undefined): string {
  if (!reason) return 'Semaphore rejected the request without a diagnostic message.';
  return reason
    .replace(/(?:\+?63|0)9\d{9}/gu, '[redacted-mobile]')
    .replace(/\b[a-z0-9_-]{24,}\b/giu, '[redacted-credential]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 500);
}

function safeSemaphoreCode(value: string | number | undefined): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' && /^[a-z0-9 _-]{1,80}$/iu.test(value) ? value : undefined;
}

function safeSemaphoreIdentifier(value: string | number | undefined): string | undefined {
  const candidate = value === undefined ? '' : String(value);
  return /^[a-z0-9-]{1,100}$/iu.test(candidate) ? candidate : undefined;
}

export function normalizePostmarkEvent(type: string): DeliveryReceipt['status'] {
  return (
    (
      {
        Delivery: 'DELIVERED',
        Bounce: 'BOUNCED',
        SpamComplaint: 'COMPLAINED',
        SubscriptionChange: 'SUPPRESSED',
      } as const
    )[type as 'Delivery'] ?? 'UNKNOWN'
  );
}

export function normalizeSemaphoreStatus(status: string): DeliveryReceipt['status'] {
  const normalized = status.toLowerCase();
  if (['delivered', 'sent'].includes(normalized)) return 'DELIVERED';
  if (['pending', 'queued'].includes(normalized)) return 'DELAYED';
  if (['failed', 'refunded', 'undelivered'].includes(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

export function generateOtp(): string {
  return String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0');
}

export function hashOtp(otp: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;
}

export function verifyOtp(otp: string, encoded: string): boolean {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(otp, salt, 32);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function deliveryKey(
  channel: string,
  destination: string,
  template: string,
  secret: string,
): string {
  return createHash('sha256')
    .update(`${channel}:${destination}:${template}:${secret}`)
    .digest('hex');
}
