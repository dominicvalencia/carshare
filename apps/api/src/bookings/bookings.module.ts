import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module';
import { FilesModule } from '../files/files.module';
import { OwnersModule } from '../owners/owners.module';
import { PaymentsModule } from '../payments/payments.module';
import { RenterVerificationModule } from '../renter-verification/renter-verification.module';
import {
  AdminBookingsController,
  OwnerBookingsController,
  RenterBookingsController,
} from './bookings.controller';
import { BookingProjectionService } from './booking-projection.service';
import { BookingsService } from './bookings.service';
import { OccupancyService } from './occupancy.service';
import { OutboxService } from './outbox.service';

@Module({
  controllers: [RenterBookingsController, OwnerBookingsController, AdminBookingsController],
  exports: [BookingsService, OccupancyService],
  imports: [DiscoveryModule, FilesModule, OwnersModule, PaymentsModule, RenterVerificationModule],
  providers: [BookingsService, BookingProjectionService, OccupancyService, OutboxService],
})
export class BookingsModule {}
