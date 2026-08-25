import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { BookingStatus, Prisma, ReviewModerationStatus, ReviewType } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { ApplicationException } from '../common/errors/application.exception';
import { AuditService } from '../audit/audit.service';
import type { RequestMetadata } from '../security/security-context';

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
    for (const [category, rating] of Object.entries(input.categoryRatings)) {
      if (!category.trim() || !Number.isInteger(rating) || rating < 1 || rating > 5)
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
        const review = await transaction.review.create({
          data: {
            bookingId: booking.id,
            authorUserId: userId,
            type: input.type,
            rating: input.rating,
            categoryRatings: input.categoryRatings,
            ...(input.text?.trim() ? { text: input.text.trim() } : {}),
            ...(input.type === ReviewType.VEHICLE
              ? { vehicleId: booking.vehicleId }
              : input.type === ReviewType.OWNER
                ? { ownerProfileId: booking.ownerProfileId }
                : { subjectUserId: booking.renterUserId }),
          },
        });
        await this.recalculate(transaction, input.type, subjectId);
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
        return review;
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

  vehicle(vehicleId: string) {
    return this.publicReviews({ vehicleId });
  }
  user(userId: string) {
    return this.publicReviews({ subjectUserId: userId });
  }
  owner(ownerProfileId: string) {
    return this.publicReviews({ ownerProfileId });
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

  private async publicReviews(where: {
    vehicleId?: string;
    ownerProfileId?: string;
    subjectUserId?: string;
  }) {
    const subjectId = where.vehicleId ?? where.ownerProfileId ?? where.subjectUserId!;
    const subjectType = where.vehicleId
      ? ReviewType.VEHICLE
      : where.ownerProfileId
        ? ReviewType.OWNER
        : ReviewType.RENTER;
    const [items, rating] = await Promise.all([
      this.database.client.review.findMany({
        where: { ...where, moderationStatus: ReviewModerationStatus.PUBLISHED },
        orderBy: { createdAt: 'desc' },
        take: 100,
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
    return {
      items,
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
      where: { ...where, moderationStatus: ReviewModerationStatus.PUBLISHED },
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
}
