import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClaimsModule } from '../claims/claims.module';
import {
  AdminRentalsController,
  OwnerRentalsController,
  RenterRentalsController,
} from './rentals.controller';
import { RentalsService } from './rentals.service';

@Module({
  controllers: [RenterRentalsController, OwnerRentalsController, AdminRentalsController],
  exports: [RentalsService],
  imports: [AuditModule, ClaimsModule],
  providers: [RentalsService],
})
export class RentalsModule {}
