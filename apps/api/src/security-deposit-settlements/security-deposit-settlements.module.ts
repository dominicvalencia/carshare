import { Module } from '@nestjs/common';
import {
  AdminSecurityDepositSettlementsController,
  OwnerSecurityDepositSettlementsController,
  RenterSecurityDepositSettlementsController,
} from './security-deposit-settlements.controller';
import { SecurityDepositSettlementsService } from './security-deposit-settlements.service';

@Module({
  controllers: [
    RenterSecurityDepositSettlementsController,
    OwnerSecurityDepositSettlementsController,
    AdminSecurityDepositSettlementsController,
  ],
  exports: [SecurityDepositSettlementsService],
  providers: [SecurityDepositSettlementsService],
})
export class SecurityDepositSettlementsModule {}
