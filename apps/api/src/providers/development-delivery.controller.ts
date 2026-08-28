import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ApiEnvironment } from '@carrental/config';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestPrincipal } from '../security/security-context';
import { DevelopmentDeliveryInbox } from './development-delivery.provider';

@ApiBearerAuth()
@ApiTags('Local development')
@Controller('development/auth-deliveries')
@UseGuards(AccessTokenGuard)
export class DevelopmentDeliveryController {
  constructor(
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly database: DatabaseService,
    private readonly inbox: DevelopmentDeliveryInbox,
  ) {}

  @Get()
  async list(@CurrentPrincipal() principal: RequestPrincipal) {
    if (
      !['local', 'test'].includes(this.configuration.getOrThrow('APP_ENV', { infer: true })) ||
      this.configuration.getOrThrow('AUTH_DELIVERY_PROVIDER', { infer: true }) !== 'development'
    ) {
      throw new ApplicationException(
        'DEVELOPMENT_DELIVERY_UNAVAILABLE',
        'Development verification delivery is unavailable.',
        HttpStatus.NOT_FOUND,
      );
    }
    const user = await this.database.client.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { normalizedEmail: true, normalizedMobileNumber: true },
    });
    return {
      items: this.inbox.list(
        [user.normalizedEmail, user.normalizedMobileNumber].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    };
  }
}
