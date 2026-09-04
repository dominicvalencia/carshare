import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingStatus,
  Prisma,
  ReviewModerationStatus,
  ReviewPublicationStatus,
  ReviewType,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { ApplicationException } from '../common/errors/application.exception';
import { AuditService } from '../audit/audit.service';
import type { RequestMetadata } from '../security/security-context';
import type { ReviewListQueryDto } from './reviews.dto';

@Injectable()
export class ReviewsService {
  private readonly windowDays: number;
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(ConfigService) config: ConfigService<ApiEnvironment, true>,
  ) {
    this.windowDays = config.getOrThrow('REVIEW_WINDOW_DAYS', { infer: true });
  }

  async eligibility(userId: string, reference: string) {
    const booking = await this.bookingForParticipant(userId, reference);
    await this.publishExpired(booking.id);
    const completedAt = await this.completedAt(booking.id);
    const deadline = completedAt
      ? new Date(completedAt.getTime() + this.windowDays * 86_400_000)
      : null;
    const existing = await this.database.client.review.findMany({
      where: { bookingId: booking.id, authorUserId: userId },
      select: { id: true, type: true },
    });
    const allowedTypes =
      userId === booking.renterUserId
        ? [ReviewType.VEHICLE, ReviewType.OWNER]
        : [ReviewType.RENTER];
    return {
      bookingReference: reference,
      eligible:
        booking.status === BookingStatus.COMPLETED && Boolean(deadline && deadline >= new Date()),
      deadline,
      availableTypes: allowedTypes.filter(
        (type) => !existing.some((review) => review.type === type),
      ),
      submitted: existing,
    };
  }

  async create(
    userId: string,
    reference: string,
    input: {
      type: ReviewType;
      rating: number;
      categoryRatings: Record<string, number>;
      text?: string;
    },
  ) {
    const booking = await this.bookingForParticipant(userId, reference);
    const eligibility = await this.eligibility(userId, reference);
    if (!eligibility.eligible || !eligibility.availableTypes.includes(input.type))
      throw new ApplicationException(
        'REVIEW_NOT_ELIGIBLE',
        'This review is not available or its deadline has passed.',
        HttpStatus.CONFLICT,
      );
    const categories = this.allowedCategories(input.type);
    for (const [category, rating] of Object.entries(input.categoryRatings)) {
      if (!categories.includes(category) || !Number.isInteger(rating) || rating < 1 || rating > 5)
        throw new ApplicationException(
          'REVIEW_CATEGORY_INVALID',
          'Category ratings must be whole numbers from 1 to 5.',
          HttpStatus.BAD_REQUEST,
        );
    }
    const subjectId =
      input.type === ReviewType.VEHICLE
        ? booking.vehicleId
        : input.type === ReviewType.OWNER
          ? booking.ownerProfileId
          : booking.renterUserId;
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const counterpartSubmitted = await transaction.review.count({
          where: { bookingId: booking.id, authorUserId: { not: userId } },
        });
        const review = await transaction.review.create({
          data: {
            bookingId: booking.id,
            authorUserId: userId,
            type: input.type,
            rating: input.rating,
            categoryRatings: input.categoryRatings,
            publicationStatus:
              counterpartSubmitted > 0
                ? ReviewPublicationStatus.PUBLISHED
                : ReviewPublicationStatus.PENDING,
            publishAfter: eligibility.deadline!,
            ...(counterpartSubmitted > 0 ? { publishedAt: new Date() } : {}),
            ...(input.text?.trim() ? { text: input.text.trim() } : {}),
            ...(input.type === ReviewType.VEHICLE
              ? { vehicleId: booking.vehicleId }
              : input.type === ReviewType.OWNER
                ? { ownerProfileId: booking.ownerProfileId }
                : { subjectUserId: booking.renterUserId }),
          },
        });
        if (counterpartSubmitted > 0) {
          await transaction.review.updateMany({
            data: { publicationStatus: ReviewPublicationStatus.PUBLISHED, publishedAt: new Date() },
            where: {
              bookingId: booking.id,
              publicationStatus: ReviewPublicationStatus.PENDING,
            },
          });
          await this.recalculateBooking(transaction, booking.id);
          await transaction.outboxEvent.create({
            data: {
              aggregateId: booking.id,
              aggregateType: 'BOOKING',
              eventType: 'REVIEWS_PUBLISHED',
              payload: { bookingId: booking.id, reviewId: review.id },
            },
          });
        }
        await transaction.outboxEvent.create({
          data: {
            aggregateId: booking.id,
            aggregateType: 'BOOKING',
            eventType: 'REVIEW_SUBMITTED',
            payload: {
              bookingId: booking.id,
              reviewId: review.id,
              reviewType: input.type,
              subjectId,
              recipientUserId:
                userId === booking.renterUserId ? booking.ownerUserId : booking.renterUserId,
            },
          },
        });
        await transaction.analyticsEvent.create({
          data: {
            eventType: 'REVIEW_SUBMITTED',
            userId,
            bookingId: booking.id,
            vehicleId: booking.vehicleId,
            metadata: { type: input.type },
          },
        });
        return {
          ...review,
          categories,
          publicationStatus: counterpartSubmitted > 0 ? 'PUBLISHED' : 'PENDING',
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ApplicationException(
          'REVIEW_ALREADY_SUBMITTED',
          'A review of this type was already submitted.',
          HttpStatus.CONFLICT,
        );
      throw error;
    }
  }

  vehicle(vehicleId: string, query: ReviewListQueryDto) {
    return this.publicReviews({ vehicleId }, query);
  }
  user(userId: string, query: ReviewListQueryDto) {
    return this.publicReviews({ subjectUserId: userId }, query);
  }
  owner(ownerProfileId: string, query: ReviewListQueryDto) {
    return this.publicReviews({ ownerProfileId }, query);
  }
  async host(publicReference: string, query: ReviewListQueryDto) {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: { id: true },
      where: { publicReference },
    });
    if (!owner)
      throw new ApplicationException('HOST_NOT_FOUND', 'Host not found.', HttpStatus.NOT_FOUND);
    return this.publicReviews({ ownerProfileId: owner.id }, query);
  }

  async mine(userId: string) {
    await this.publishExpiredForUser(userId);
    const reviewSelect = {
      booking: {
        select: {
          publicReference: true,
          vehicle: { select: { make: true, model: true, modelYear: true } },
        },
      },
      categoryRatings: true,
      createdAt: true,
      id: true,
      moderationStatus: true,
      publicationStatus: true,
      rating: true,
      text: true,
      type: true,
    } satisfies Prisma.ReviewSelect;
    const [written, received, completed] = await Promise.all([
      this.database.client.review.findMany({
        where: { authorUserId: userId },
        orderBy: { createdAt: 'desc' },
        select: reviewSelect,
      }),
      this.database.client.review.findMany({
        where: {
          moderationStatus: ReviewModerationStatus.PUBLISHED,
          publicationStatus: ReviewPublicationStatus.PUBLISHED,
          OR: [{ subjectUserId: userId }, { ownerProfile: { userId } }],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          ...reviewSelect,
          author: { select: { profile: { select: { firstName: true } } } },
        },
      }),
      this.database.client.booking.findMany({
        where: {
          status: BookingStatus.COMPLETED,
          OR: [{ renterUserId: userId }, { ownerUserId: userId }],
        },
        select: {
          ownerUserId: true,
          publicReference: true,
          renterUserId: true,
          reviews: { where: { authorUserId: userId }, select: { type: true } },
          statusHistory: {
            where: { toStatus: BookingStatus.COMPLETED },
            orderBy: { occurredAt: 'desc' },
            take: 1,
            select: { occurredAt: true },
          },
          vehicle: { select: { make: true, model: true, modelYear: true } },
        },
      }),
    ]);
    const now = Date.now();
    const pending = completed.flatMap((booking) => {
      const completedAt = booking.statusHistory[0]?.occurredAt;
      if (!completedAt) return [];
      const deadline = new Date(completedAt.getTime() + this.windowDays * 86_400_000);
      if (deadline.getTime() < now) return [];
      const allowed =
        booking.renterUserId === userId
          ? [ReviewType.VEHICLE, ReviewType.OWNER]
          : [ReviewType.RENTER];
      const availableTypes = allowed.filter(
        (type) => !booking.reviews.some((review) => review.type === type),
      );
      return availableTypes.length
        ? [
            {
              availableTypes,
              bookingReference: booking.publicReference,
              deadline,
              vehicle: booking.vehicle,
            },
          ]
        : [];
    });
    return { pending, received, written };
  }

  async moderate(
    adminUserId: string,
    reviewId: string,
    status: ReviewModerationStatus,
    reason: string,
    request: RequestMetadata,
  ) {
    const report = await this.database.client.moderationReport.findFirst({ where: { reviewId } });
    if (!report)
      throw new ApplicationException(
        'MODERATION_REPORT_REQUIRED',
        'Only reported reviews can be moderated.',
        HttpStatus.CONFLICT,
      );
    const review = await this.database.client.review.findUnique({ where: { id: reviewId } });
    if (!review)
      throw new ApplicationException('REVIEW_NOT_FOUND', 'Review not found.', HttpStatus.NOT_FOUND);
    const subjectId = review.vehicleId ?? review.ownerProfileId ?? review.subjectUserId;
    const updated = await this.database.client.$transaction(async (transaction) => {
      const value = await transaction.review.update({
        where: { id: reviewId },
        data: {
          moderationStatus: status,
          moderationReason: reason.trim(),
          moderatedAt: new Date(),
          moderatedByUserId: adminUserId,
        },
      });
      if (subjectId) await this.recalculate(transaction, review.type, subjectId);
      return value;
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'REVIEW_MODERATED',
      targetType: 'REVIEW',
      targetId: reviewId,
      reason,
      metadata: { fromStatus: review.moderationStatus, toStatus: status },
      request,
    });
    return updated;
  }

  private async publicReviews(
    where: {
      vehicleId?: string;
      ownerProfileId?: string;
      subjectUserId?: string;
    },
    query: ReviewListQueryDto,
  ) {
    await this.publishExpiredForSubject(where);
    const subjectId = where.vehicleId ?? where.ownerProfileId ?? where.subjectUserId!;
    const subjectType = where.vehicleId
      ? ReviewType.VEHICLE
      : where.ownerProfileId
        ? ReviewType.OWNER
        : ReviewType.RENTER;
    const cursor = query.cursor ? this.decodeReviewCursor(query.cursor) : null;
    const [rows, rating] = await Promise.all([
      this.database.client.review.findMany({
        where: {
          ...where,
          moderationStatus: ReviewModerationStatus.PUBLISHED,
          publicationStatus: ReviewPublicationStatus.PUBLISHED,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: {
          id: true,
          rating: true,
          categoryRatings: true,
          text: true,
          type: true,
          createdAt: true,
          author: { select: { profile: { select: { firstName: true } } } },
        },
      }),
      this.database.client.ratingProjection.findUnique({
        where: { subjectType_subjectId: { subjectType, subjectId } },
      }),
    ]);
    const hasNextPage = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return {
      items,
      pageInfo: {
        hasNextPage,
        nextCursor: hasNextPage && items.length ? this.encodeReviewCursor(items.at(-1)!) : null,
      },
      aggregate: rating
        ? { reviewCount: rating.reviewCount, averageRating: rating.averageRating.toString() }
        : { reviewCount: 0, averageRating: '0.00' },
    };
  }

  private async bookingForParticipant(userId: string, reference: string) {
    const booking = await this.database.client.booking.findFirst({
      where: {
        publicReference: reference,
        OR: [{ renterUserId: userId }, { ownerUserId: userId }],
      },
      select: {
        id: true,
        publicReference: true,
        status: true,
        renterUserId: true,
        ownerUserId: true,
        ownerProfileId: true,
        vehicleId: true,
      },
    });
    if (!booking)
      throw new ApplicationException(
        'BOOKING_NOT_FOUND',
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    return booking;
  }
  private async completedAt(bookingId: string) {
    return (
      (
        await this.database.client.bookingStatusHistory.findFirst({
          where: { bookingId, toStatus: BookingStatus.COMPLETED },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        })
      )?.occurredAt ?? null
    );
  }
  private async recalculate(
    transaction: Prisma.TransactionClient,
    subjectType: ReviewType,
    subjectId: string,
  ) {
    const where =
      subjectType === ReviewType.VEHICLE
        ? { vehicleId: subjectId }
        : subjectType === ReviewType.OWNER
          ? { ownerProfileId: subjectId }
          : { subjectUserId: subjectId };
    const aggregate = await transaction.review.aggregate({
      where: {
        ...where,
        moderationStatus: ReviewModerationStatus.PUBLISHED,
        publicationStatus: ReviewPublicationStatus.PUBLISHED,
      },
      _count: { rating: true },
      _sum: { rating: true },
      _avg: { rating: true },
    });
    await transaction.ratingProjection.upsert({
      where: { subjectType_subjectId: { subjectType, subjectId } },
      create: {
        subjectType,
        subjectId,
        reviewCount: aggregate._count.rating,
        ratingSum: aggregate._sum.rating ?? 0,
        averageRating: aggregate._avg.rating ?? 0,
      },
      update: {
        reviewCount: aggregate._count.rating,
        ratingSum: aggregate._sum.rating ?? 0,
        averageRating: aggregate._avg.rating ?? 0,
        recalculatedAt: new Date(),
      },
    });
  }

  private allowedCategories(type: ReviewType): readonly string[] {
    if (type === ReviewType.VEHICLE) return ['cleanliness', 'condition', 'accuracy'];
    if (type === ReviewType.OWNER) return ['communication', 'handover', 'responsiveness'];
    return ['communication', 'cleanliness', 'punctuality'];
  }

  private async recalculateBooking(transaction: Prisma.TransactionClient, bookingId: string) {
    const reviews = await transaction.review.findMany({
      select: { ownerProfileId: true, subjectUserId: true, type: true, vehicleId: true },
      where: { bookingId, publicationStatus: ReviewPublicationStatus.PUBLISHED },
    });
    for (const review of reviews) {
      const subjectId = review.vehicleId ?? review.ownerProfileId ?? review.subjectUserId;
      if (subjectId) await this.recalculate(transaction, review.type, subjectId);
    }
  }

  private async publishExpired(bookingId: string) {
    const now = new Date();
    await this.database.client.$transaction(async (transaction) => {
      const result = await transaction.review.updateMany({
        data: { publicationStatus: ReviewPublicationStatus.PUBLISHED, publishedAt: now },
        where: {
          bookingId,
          publicationStatus: ReviewPublicationStatus.PENDING,
          publishAfter: { lte: now },
        },
      });
      if (result.count) await this.recalculateBooking(transaction, bookingId);
      if (result.count)
        await transaction.outboxEvent.create({
          data: {
            aggregateId: bookingId,
            aggregateType: 'BOOKING',
            eventType: 'REVIEWS_PUBLISHED',
            payload: { bookingId },
          },
        });
    });
  }

  private async publishExpiredForUser(userId: string) {
    const rows = await this.database.client.review.findMany({
      distinct: ['bookingId'],
      select: { bookingId: true },
      where: {
        publicationStatus: ReviewPublicationStatus.PENDING,
        publishAfter: { lte: new Date() },
        OR: [{ authorUserId: userId }, { subjectUserId: userId }, { ownerProfile: { userId } }],
      },
    });
    await Promise.all(rows.map(({ bookingId }) => this.publishExpired(bookingId)));
  }

  private async publishExpiredForSubject(where: {
    vehicleId?: string;
    ownerProfileId?: string;
    subjectUserId?: string;
  }) {
    const rows = await this.database.client.review.findMany({
      distinct: ['bookingId'],
      select: { bookingId: true },
      where: {
        ...where,
        publicationStatus: ReviewPublicationStatus.PENDING,
        publishAfter: { lte: new Date() },
      },
    });
    await Promise.all(rows.map(({ bookingId }) => this.publishExpired(bookingId)));
  }

  private encodeReviewCursor(review: { createdAt: Date; id: string }) {
    return Buffer.from(
      JSON.stringify({ createdAt: review.createdAt.toISOString(), id: review.id }),
    ).toString('base64');
  }

  private decodeReviewCursor(value: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as {
        createdAt?: unknown;
        id?: unknown;
      };
      const createdAt = new Date(String(parsed.createdAt));
      if (typeof parsed.id !== 'string' || !parsed.id || Number.isNaN(createdAt.getTime()))
        throw new Error();
      return { createdAt, id: parsed.id };
    } catch {
      throw new ApplicationException(
        'REVIEW_CURSOR_INVALID',
        'Review cursor is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
