import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import {
  AdminClaimsController,
  OwnerClaimsController,
  RenterClaimsController,
} from './claims.controller';
import { ClaimsService } from './claims.service';
import { OwnerWorkspaceClaimsController } from './owner-workspace-claims.controller';

@Module({
  controllers: [
    OwnerClaimsController,
    RenterClaimsController,
    AdminClaimsController,
    OwnerWorkspaceClaimsController,
  ],
  exports: [ClaimsService],
  imports: [PaymentsModule],
  providers: [ClaimsService],
})
export class ClaimsModule {}
