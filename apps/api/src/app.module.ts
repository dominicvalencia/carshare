import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { EnvironmentModule } from './config/environment.module';
import { LoggingModule } from './common/logging/logging.module';
import { RequestContextModule } from './common/request-context/request-context.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './health/health.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { ApiResponseInterceptor } from './common/http/api-response.interceptor';
import { SecurityModule } from './security/security.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { SessionsModule } from './sessions/sessions.module';
import { OwnersModule } from './owners/owners.module';
import { FilesModule } from './files/files.module';
import { AdminModule } from './admin/admin.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { RentalsModule } from './rentals/rentals.module';
import { ClaimsModule } from './claims/claims.module';
import { PayoutsModule } from './payouts/payouts.module';
import { CommunicationsModule } from './communications/communications.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SupportModule } from './support/support.module';
import { RenterVerificationModule } from './renter-verification/renter-verification.module';
import { GeographyModule } from './geography/geography.module';
import { OwnerAnalyticsModule } from './owner-analytics/owner-analytics.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { LocationsModule } from './locations/locations.module';
import { SecurityDepositSettlementsModule } from './security-deposit-settlements/security-deposit-settlements.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    EnvironmentModule,
    LoggingModule,
    RequestContextModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
    SecurityModule,
    ProvidersModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    UsersModule,
    SessionsModule,
    OwnersModule,
    FilesModule,
    AdminModule,
    VehiclesModule,
    DiscoveryModule,
    BookingsModule,
    PaymentsModule,
    RentalsModule,
    ClaimsModule,
    PayoutsModule,
    CommunicationsModule,
    NotificationsModule,
    ReviewsModule,
    SupportModule,
    RenterVerificationModule,
    GeographyModule,
    OwnerAnalyticsModule,
    FulfillmentModule,
    LocationsModule,
    SecurityDepositSettlementsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}
