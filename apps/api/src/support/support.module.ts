import { Module } from '@nestjs/common';
import {
  AdminModerationController,
  AdminSupportController,
  SupportController,
} from './support.controller';
import { SupportService } from './support.service';
@Module({
  controllers: [SupportController, AdminSupportController, AdminModerationController],
  providers: [SupportService],
})
export class SupportModule {}
