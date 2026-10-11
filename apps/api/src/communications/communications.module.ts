import { Module } from '@nestjs/common';
import {
  CommunicationsController,
  ReportsController,
  AdminMessageModerationController,
} from './communications.controller';
import { CommunicationsService } from './communications.service';
import { OwnerWorkspaceCommunicationsController } from './owner-workspace-communications.controller';

@Module({
  controllers: [
    CommunicationsController,
    ReportsController,
    AdminMessageModerationController,
    OwnerWorkspaceCommunicationsController,
  ],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
