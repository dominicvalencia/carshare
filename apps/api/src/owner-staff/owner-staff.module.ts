import { Module } from '@nestjs/common';
import {
  OwnerStaffAccessController,
  OwnerStaffAccessLinkController,
  OwnerStaffController,
  OwnerStaffInvitationController,
} from './owner-staff.controller';
import { OwnerStaffService } from './owner-staff.service';

@Module({
  controllers: [
    OwnerStaffController,
    OwnerStaffInvitationController,
    OwnerStaffAccessController,
    OwnerStaffAccessLinkController,
  ],
  providers: [OwnerStaffService],
})
export class OwnerStaffModule {}
