export interface EmailMessage {
  readonly actionUrl: string;
  readonly to: string;
  readonly template: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  readonly token: string;
}

export interface SmsMessage {
  readonly to: string;
  readonly template: 'LOGIN_OTP' | 'MOBILE_VERIFICATION_OTP';
  readonly code: string;
}

export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<void>;
}
