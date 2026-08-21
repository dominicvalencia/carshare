import { Module } from '@nestjs/common';
import { OwnersModule } from '../owners/owners.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AdminVehiclesController } from './admin-vehicles.controller';
import {
  OwnerVehiclesController,
  VehicleReferenceDataController,
} from './owner-vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [OwnerVehiclesController, VehicleReferenceDataController, AdminVehiclesController],
  exports: [VehiclesService],
  imports: [BookingsModule, OwnersModule],
  providers: [VehiclesService],
})
export class VehiclesModule {}
