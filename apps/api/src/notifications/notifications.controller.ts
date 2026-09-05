import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  NotificationQueryDto,
  RegisterPushTokenDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiBearerAuth()
@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(@CurrentPrincipal() p: RequestPrincipal, @Query() q: NotificationQueryDto) {
    return this.notifications.list(p.userId, q);
  }
  @Get('summary') summary(
    @CurrentPrincipal() p: RequestPrincipal,
    @Query() q: NotificationQueryDto,
  ) {
    return this.notifications.summary(p.userId, q.audience);
  }
  @Post('read-all') readAll(
    @CurrentPrincipal() p: RequestPrincipal,
    @Query() q: NotificationQueryDto,
  ) {
    return this.notifications.readAll(p.userId, q.audience);
  }
  @Post(':id/read') read(@CurrentPrincipal() p: RequestPrincipal, @Param('id') id: string) {
    return this.notifications.read(p.userId, id);
  }
  @Post(':id/opened') opened(@CurrentPrincipal() p: RequestPrincipal, @Param('id') id: string) {
    return this.notifications.opened(p.userId, id);
  }
}

@ApiBearerAuth()
@ApiTags('Notification preferences')
@Controller('notification-preferences')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() get(@CurrentPrincipal() p: RequestPrincipal) {
    return this.notifications.preferences(p.userId);
  }
  @Patch() update(
    @CurrentPrincipal() p: RequestPrincipal,
    @Body() input: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(p.userId, input.preferences);
  }
}

@ApiBearerAuth()
@ApiTags('Push devices')
@Controller('push-tokens')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class PushTokensController {
  constructor(private readonly notifications: NotificationsService) {}
  @Post() register(@CurrentPrincipal() p: RequestPrincipal, @Body() input: RegisterPushTokenDto) {
    return this.notifications.registerToken(p.userId, p.sessionId, input);
  }
  @Delete(':id') remove(@CurrentPrincipal() p: RequestPrincipal, @Param('id') id: string) {
    return this.notifications.deleteToken(p.userId, id);
  }
}
