import { Module } from '@nestjs/common';
import {
  CommunicationsController,
  ReportsController,
  AdminMessageModerationController,
} from './communications.controller';
import { CommunicationsService } from './communications.service';

@Module({
  controllers: [CommunicationsController, ReportsController, AdminMessageModerationController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
