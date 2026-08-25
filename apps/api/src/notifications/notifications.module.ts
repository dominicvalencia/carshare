import { Module } from '@nestjs/common';
import {
  NotificationPreferencesController,
  NotificationsController,
  PushTokensController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
@Module({
  controllers: [NotificationsController, NotificationPreferencesController, PushTokensController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
