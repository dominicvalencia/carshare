import { Module } from '@nestjs/common';
import { OwnerStaffController, OwnerStaffInvitationController } from './owner-staff.controller';
import { OwnerStaffService } from './owner-staff.service';

@Module({
  controllers: [OwnerStaffController, OwnerStaffInvitationController],
  providers: [OwnerStaffService],
})
export class OwnerStaffModule {}
