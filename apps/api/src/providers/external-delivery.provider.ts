import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import type {
  DeliveryReceipt,
  EmailMessage,
  OtpSmsProvider,
  SmsMessage,
  TransactionalEmailProvider,
} from './delivery.provider';
import { EmailProvider, SmsProvider } from './delivery.provider';

const REQUEST_TIMEOUT_MS = 10_000;

export class DisabledEmailProvider extends EmailProvider {
  async send(): Promise<void> {
    throw new Error('Transactional email is disabled.');
  }
}

export class DisabledSmsProvider extends SmsProvider {
  async send(): Promise<void> {
    throw new Error('SMS OTP delivery is disabled.');
  }
}

@Injectable()
export class PostmarkEmailProvider extends EmailProvider implements TransactionalEmailProvider {
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
    const token = this.configuration.getOrThrow('POSTMARK_SERVER_TOKEN', { infer: true });
    const from = this.configuration.getOrThrow('POSTMARK_FROM_EMAIL', { infer: true });
    const response = await fetch('https://api.postmarkapp.com/email/withTemplate', {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
        'X-CarShare-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        From: from,
        To: message.to,
        TemplateAlias: message.template.toLowerCase().replaceAll('_', '-'),
        MessageStream:
          this.configuration.get('POSTMARK_MESSAGE_STREAM', { infer: true }) ?? 'outbound',
        TemplateModel: { ...message.variables, action_url: message.actionUrl },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      MessageID?: string;
      ErrorCode?: number;
    };
    if (!response.ok || body.ErrorCode)
      throw new Error(
        response.status >= 500 || response.status === 429
          ? 'EMAIL_PROVIDER_RETRYABLE'
          : 'EMAIL_PROVIDER_REJECTED',
      );
    return {
      provider: 'postmark',
      providerMessageId: body.MessageID ?? idempotencyKey,
      status: 'ACCEPTED',
    };
  }
}

@Injectable()
export class SemaphoreSmsProvider extends SmsProvider implements OtpSmsProvider {
  constructor(private readonly configuration: ConfigService<ApiEnvironment, true>) {
    super();
  }

  async send(message: SmsMessage): Promise<void> {
    await this.sendOtp(message, deliveryKey('sms', message.to, message.template, message.code));
  }

  async sendOtp(message: SmsMessage, idempotencyKey: string): Promise<DeliveryReceipt> {
    const form = new URLSearchParams({
      apikey: this.configuration.getOrThrow('SEMAPHORE_API_KEY', { infer: true }),
      number: message.to,
      message: renderSms(message),
    });
    const sender = this.configuration.get('SEMAPHORE_SENDER_NAME', { infer: true });
    if (sender) form.set('sendername', sender);
    const response = await fetch(
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
    const body = (await response.json().catch(() => [])) as { message_id?: string | number }[];
    if (!response.ok)
      throw new Error(
        response.status >= 500 || response.status === 429
          ? 'SMS_PROVIDER_RETRYABLE'
          : 'SMS_PROVIDER_REJECTED',
      );
    return {
      provider: 'semaphore',
      providerMessageId: String(body[0]?.message_id ?? idempotencyKey),
      status: 'ACCEPTED',
    };
  }
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
  if (normalized === 'delivered') return 'DELIVERED';
  if (['pending', 'queued'].includes(normalized)) return 'DELAYED';
  if (['failed', 'undelivered'].includes(normalized)) return 'FAILED';
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

function renderSms(message: SmsMessage): string {
  return message.template === 'LOGIN_OTP'
    ? `Your CarShare login code is ${message.code}. It expires soon.`
    : `Your CarShare verification code is ${message.code}. It expires soon.`;
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
