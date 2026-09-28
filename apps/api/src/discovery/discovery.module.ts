import { Module } from '@nestjs/common';
import {
  AdminVehicleVisibilityController,
  FavoritesController,
  PricingQuotesController,
  PublicHostsController,
  PublicVehiclesController,
  RenterHistoryController,
  RenterRecommendationsController,
} from './discovery.controller';
import { DiscoveryAnalyticsService } from './analytics.service';
import { AvailabilityService } from './availability.service';
import { RentalDurationService } from './duration.service';
import { FavoritesService } from './favorites.service';
import { PricingQuotesService } from './pricing-quotes.service';
import { PublicVehicleEligibilityService } from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';
import { PublicVehiclesService } from './public-vehicles.service';
import { RenterHistoryService } from './renter-history.service';
import { SavedSimilarityService } from './saved-similarity.service';
import { FilesModule } from '../files/files.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';

@Module({
  imports: [FilesModule, FulfillmentModule],
  controllers: [
    PublicVehiclesController,
    PublicHostsController,
    PricingQuotesController,
    FavoritesController,
    RenterHistoryController,
    RenterRecommendationsController,
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
    RenterHistoryService,
    SavedSimilarityService,
  ],
  exports: [
    AvailabilityService,
    DiscoveryAnalyticsService,
    RentalDurationService,
    PublicVehicleEligibilityService,
  ],
})
export class DiscoveryModule {}
