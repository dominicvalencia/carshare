export interface EmailMessage {
  readonly actionUrl: string;
  readonly to: string;
  readonly template:
    | 'EMAIL_VERIFICATION'
    | 'PASSWORD_RESET'
    | 'BOOKING_UPDATE'
    | 'SUPPORT_UPDATE'
    | 'REVIEW_REMINDER'
    | 'RETURN_REMINDER'
    | 'OPERATIONAL';
  readonly token: string;
  readonly variables?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SmsMessage {
  readonly to: string;
  readonly template: 'LOGIN_OTP' | 'MOBILE_VERIFICATION_OTP';
  readonly code: string;
}

export type DeliveryStatus =
  | 'ACCEPTED'
  | 'DELIVERED'
  | 'DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'SUPPRESSED'
  | 'FAILED'
  | 'UNKNOWN';

export interface DeliveryReceipt {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
}

export interface TransactionalEmailProvider {
  sendTransactional(message: EmailMessage, idempotencyKey: string): Promise<DeliveryReceipt>;
}

export interface OtpSmsProvider {
  sendOtp(message: SmsMessage, idempotencyKey: string): Promise<DeliveryReceipt>;
}

export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<void>;
}
