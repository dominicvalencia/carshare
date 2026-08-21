import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  EmailProvider,
  type EmailMessage,
  SmsProvider,
  type SmsMessage,
} from './delivery.provider';

@Injectable()
export class DevelopmentEmailProvider extends EmailProvider {
  constructor(private readonly logger: PinoLogger) {
    super();
    this.logger.setContext(DevelopmentEmailProvider.name);
  }

  async send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { destination: maskEmail(message.to), template: message.template },
      'Development email delivery accepted; authentication secret intentionally omitted',
    );
  }
}

@Injectable()
export class DevelopmentSmsProvider extends SmsProvider {
  constructor(private readonly logger: PinoLogger) {
    super();
    this.logger.setContext(DevelopmentSmsProvider.name);
  }

  async send(message: SmsMessage): Promise<void> {
    this.logger.info(
      { destination: `***${message.to.slice(-4)}`, template: message.template },
      'Development SMS delivery accepted; OTP intentionally omitted',
    );
  }
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
