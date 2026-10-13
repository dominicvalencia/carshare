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
import { VehicleChangeProposalSnapshotService } from './vehicle-change-proposal-snapshot.service';
import { VehicleChangeProposalsService } from './vehicle-change-proposals.service';
import { OwnerWorkspaceVehicleChangeProposalsController } from './owner-workspace-vehicle-change-proposals.controller';
import { OwnerVehicleChangeProposalsController } from './owner-vehicle-change-proposals.controller';
import { AdminVehicleChangeProposalsController } from './admin-vehicle-change-proposals.controller';
import { AdminVehicleChangeProposalsService } from './admin-vehicle-change-proposals.service';

@Module({
  controllers: [
    OwnerVehiclesController,
    OwnerWorkspaceVehiclesController,
    OwnerWorkspaceVehicleChangeProposalsController,
    OwnerVehicleChangeProposalsController,
    VehicleReferenceDataController,
    AdminVehiclesController,
    AdminVehicleChangeProposalsController,
  ],
  exports: [VehicleChangeProposalSnapshotService, VehiclesService],
  imports: [BookingsModule, FilesModule, GeographyModule, OwnersModule],
  providers: [
    AdminVehicleChangeProposalsService,
    VehicleChangeProposalSnapshotService,
    VehicleChangeProposalsService,
    VehiclesService,
  ],
})
export class VehiclesModule {}
