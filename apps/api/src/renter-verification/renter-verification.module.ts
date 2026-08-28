import { Module } from '@nestjs/common';
import { GeographyModule } from '../geography/geography.module';
import {
  AdminRenterVerificationController,
  RenterVerificationController,
} from './renter-verification.controller';
import { RenterEligibilityService } from './renter-eligibility.service';
import { RenterVerificationService } from './renter-verification.service';

@Module({
  imports: [GeographyModule],
  controllers: [RenterVerificationController, AdminRenterVerificationController],
  exports: [RenterEligibilityService, RenterVerificationService],
  providers: [RenterEligibilityService, RenterVerificationService],
})
export class RenterVerificationModule {}
