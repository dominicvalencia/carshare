import { Module } from '@nestjs/common';
import {
  AdminVehicleVisibilityController,
  FavoritesController,
  PricingQuotesController,
  PublicVehiclesController,
} from './discovery.controller';
import { DiscoveryAnalyticsService } from './analytics.service';
import { AvailabilityService } from './availability.service';
import { RentalDurationService } from './duration.service';
import { FavoritesService } from './favorites.service';
import { PricingQuotesService } from './pricing-quotes.service';
import { PublicVehicleEligibilityService } from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';
import { PublicVehiclesService } from './public-vehicles.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [
    PublicVehiclesController,
    PricingQuotesController,
    FavoritesController,
    AdminVehicleVisibilityController,
  ],
  providers: [
    DiscoveryAnalyticsService,
    RentalDurationService,
    PublicVehicleEligibilityService,
    AvailabilityService,
    PublicProjectionService,
    PublicVehiclesService,
    PricingQuotesService,
    FavoritesService,
  ],
  exports: [DiscoveryAnalyticsService, RentalDurationService, PublicVehicleEligibilityService],
})
export class DiscoveryModule {}
