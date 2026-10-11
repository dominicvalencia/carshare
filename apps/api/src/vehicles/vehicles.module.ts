import { Module } from '@nestjs/common';
import { OwnersModule } from '../owners/owners.module';
import { BookingsModule } from '../bookings/bookings.module';
import { FilesModule } from '../files/files.module';
import { GeographyModule } from '../geography/geography.module';
import { AdminVehiclesController } from './admin-vehicles.controller';
import {
  OwnerVehiclesController,
  VehicleReferenceDataController,
} from './owner-vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { OwnerWorkspaceVehiclesController } from './owner-workspace-vehicles.controller';

@Module({
  controllers: [
    OwnerVehiclesController,
    OwnerWorkspaceVehiclesController,
    VehicleReferenceDataController,
    AdminVehiclesController,
  ],
  exports: [VehiclesService],
  imports: [BookingsModule, FilesModule, GeographyModule, OwnersModule],
  providers: [VehiclesService],
})
export class VehiclesModule {}
