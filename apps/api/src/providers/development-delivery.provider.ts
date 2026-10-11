import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { ApiEnvironment } from '@carrental/config';
import {
  EmailProvider,
  type EmailMessage,
  SmsProvider,
  type SmsMessage,
  renderSmsMessage,
} from './delivery.provider';

export interface DevelopmentDelivery {
  readonly id: string;
  readonly channel: 'EMAIL' | 'SMS';
  readonly destination: string;
  readonly template: EmailMessage['template'] | SmsMessage['template'];
  readonly secret: string;
  readonly content?: string;
  readonly createdAt: string;
}

@Injectable()
export class DevelopmentDeliveryInbox {
  private readonly items: DevelopmentDelivery[] = [];

  add(delivery: Omit<DevelopmentDelivery, 'id' | 'createdAt'>): void {
    this.items.unshift({
      ...delivery,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    this.items.splice(100);
  }

  list(destinations: readonly string[]): readonly DevelopmentDelivery[] {
    const allowed = new Set(destinations);
    return this.items.filter(({ destination }) => allowed.has(destination)).slice(0, 20);
  }

  latest(
    destination: string,
    template: DevelopmentDelivery['template'],
  ): DevelopmentDelivery | undefined {
    return this.items.find(
      (delivery) => delivery.destination === destination && delivery.template === template,
    );
  }
}

@Injectable()
export class DevelopmentEmailProvider extends EmailProvider {
  constructor(
    private readonly logger: PinoLogger,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly inbox: DevelopmentDeliveryInbox,
  ) {
    super();
    this.logger.setContext(DevelopmentEmailProvider.name);
  }

  async send(message: EmailMessage): Promise<void> {
    this.assertDevelopmentDelivery();
    this.inbox.add({
      channel: 'EMAIL',
      destination: message.to,
      secret: message.token,
      template: message.template,
    });
    this.logger.info(
      { destination: maskEmail(message.to), template: message.template },
      'Development email delivery accepted; authentication secret intentionally omitted',
    );
  }

  private assertDevelopmentDelivery(): void {
    if (
      this.configuration.getOrThrow('AUTH_DELIVERY_PROVIDER', { infer: true }) !== 'development' ||
      this.configuration.getOrThrow('APP_ENV', { infer: true }) === 'production'
    ) {
      throw new Error('External email delivery provider is not configured.');
    }
  }
}

@Injectable()
export class DevelopmentSmsProvider extends SmsProvider {
  constructor(
    private readonly logger: PinoLogger,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly inbox: DevelopmentDeliveryInbox,
  ) {
    super();
    this.logger.setContext(DevelopmentSmsProvider.name);
  }

  async send(message: SmsMessage): Promise<void> {
    if (
      this.configuration.getOrThrow('AUTH_DELIVERY_PROVIDER', { infer: true }) !== 'development' ||
      this.configuration.getOrThrow('APP_ENV', { infer: true }) === 'production'
    ) {
      throw new Error('External SMS delivery provider is not configured.');
    }
    this.inbox.add({
      channel: 'SMS',
      content: renderSmsMessage(message),
      destination: message.to,
      secret: message.template === 'STAFF_INVITATION' ? message.invitationUrl : message.code,
      template: message.template,
    });
    this.logger.info(
      { destination: `***${message.to.slice(-4)}`, template: message.template },
      'Development SMS delivery accepted; authentication secret intentionally omitted',
    );
  }
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
