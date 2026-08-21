import { Injectable } from '@nestjs/common';
import type { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';

export const AnalyticsEventType = {
  FAVORITE_ADDED: 'FAVORITE_ADDED',
  QUOTE_CREATED: 'QUOTE_CREATED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_REQUESTED: 'QUOTE_REQUESTED',
  SEARCH_PERFORMED: 'SEARCH_PERFORMED',
  SEARCH_RESULT_VIEWED: 'SEARCH_RESULT_VIEWED',
  VEHICLE_VIEWED: 'VEHICLE_VIEWED',
  BOOKING_HOLD_ATTEMPTED: 'BOOKING_HOLD_ATTEMPTED',
  BOOKING_HOLD_CREATED: 'BOOKING_HOLD_CREATED',
  BOOKING_HOLD_CONFLICT: 'BOOKING_HOLD_CONFLICT',
  BOOKING_HOLD_EXPIRED: 'BOOKING_HOLD_EXPIRED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_OWNER_REQUESTED: 'BOOKING_OWNER_REQUESTED',
  BOOKING_OWNER_ACCEPTED: 'BOOKING_OWNER_ACCEPTED',
  BOOKING_OWNER_REJECTED: 'BOOKING_OWNER_REJECTED',
} as const;

@Injectable()
export class DiscoveryAnalyticsService {
  constructor(private readonly database: DatabaseService) {}

  record(input: {
    eventType: string;
    userId?: string | undefined;
    vehicleId?: string | undefined;
    quoteId?: string | undefined;
    bookingId?: string | undefined;
    correlationId?: string | undefined;
    metadata?: Prisma.InputJsonValue;
  }): void {
    void this.database.client.analyticsEvent
      .create({
        data: {
          eventType: input.eventType,
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
          ...(input.quoteId ? { quoteId: input.quoteId } : {}),
          ...(input.bookingId ? { bookingId: input.bookingId } : {}),
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      })
      .catch(() => undefined);
  }
}
