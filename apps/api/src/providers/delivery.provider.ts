export interface EmailMessage {
  readonly actionUrl: string;
  readonly to: string;
  readonly template:
    | 'EMAIL_VERIFICATION'
    | 'PASSWORD_RESET'
    | 'STAFF_INVITATION'
    | 'BOOKING_UPDATE'
    | 'SUPPORT_UPDATE'
    | 'REVIEW_REMINDER'
    | 'RETURN_REMINDER'
    | 'OPERATIONAL';
  readonly token: string;
  readonly variables?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface OtpSmsMessage {
  readonly to: string;
  readonly template: 'LOGIN_OTP' | 'MOBILE_VERIFICATION_OTP' | 'STAFF_PASSWORD_RESET_OTP';
  readonly code: string;
}

export interface StaffInvitationSmsMessage {
  readonly invitationUrl: string;
  readonly roleLabel: 'Manager' | 'Staff';
  readonly template: 'STAFF_INVITATION';
  readonly to: string;
  readonly workspaceLabel: string;
}

export type SmsMessage = OtpSmsMessage | StaffInvitationSmsMessage;

export function renderSmsMessage(message: SmsMessage): string {
  if (message.template === 'STAFF_INVITATION') {
    const workspace =
      message.workspaceLabel.trim().length <= 40
        ? message.workspaceLabel.trim()
        : 'a CarShare owner';
    return `CarShare: ${workspace} invited you to join as ${message.roleLabel}. Accept within 24 hours: ${message.invitationUrl}`;
  }
  if (message.template === 'LOGIN_OTP')
    return `Your CarShare login code is ${message.code}. It expires soon.`;
  if (message.template === 'STAFF_PASSWORD_RESET_OTP')
    return `Your CarShare Staff password reset code is ${message.code}. It expires soon.`;
  return `Your CarShare verification code is ${message.code}. It expires soon.`;
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

export interface LocalEmailCertificationProvider {
  sendCertification(to: string, idempotencyKey: string): Promise<DeliveryReceipt>;
}

export interface LocalSmsCertificationProvider {
  sendCertification(to: string, idempotencyKey: string): Promise<DeliveryReceipt>;
}

export interface OtpSmsProvider {
  sendOtp(message: OtpSmsMessage, idempotencyKey: string): Promise<DeliveryReceipt>;
}

export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<void>;
}
