import {
  ReviewModerationStatus,
  ReviewPublicationStatus,
  ReviewType,
  type Prisma,
  type PrismaClient,
} from '@carrental/database';

export async function publishDueReviews(database: PrismaClient): Promise<number> {
  const due = await database.review.findMany({
    distinct: ['bookingId'],
    select: { bookingId: true },
    take: 100,
    where: {
      publicationStatus: ReviewPublicationStatus.PENDING,
      publishAfter: { lte: new Date() },
    },
  });
  let published = 0;
  for (const { bookingId } of due) {
    published += await database.$transaction(async (transaction) => {
      const result = await transaction.review.updateMany({
        data: { publicationStatus: ReviewPublicationStatus.PUBLISHED, publishedAt: new Date() },
        where: {
          bookingId,
          publicationStatus: ReviewPublicationStatus.PENDING,
          publishAfter: { lte: new Date() },
        },
      });
      if (!result.count) return 0;
      const reviews = await transaction.review.findMany({
        select: { ownerProfileId: true, subjectUserId: true, type: true, vehicleId: true },
        where: { bookingId, publicationStatus: ReviewPublicationStatus.PUBLISHED },
      });
      for (const review of reviews) {
        const subjectId = review.vehicleId ?? review.ownerProfileId ?? review.subjectUserId;
        if (subjectId) await recalculate(transaction, review.type, subjectId);
      }
      await transaction.outboxEvent.create({
        data: {
          aggregateId: bookingId,
          aggregateType: 'BOOKING',
          eventType: 'REVIEWS_PUBLISHED',
          payload: { bookingId },
        },
      });
      return result.count;
    });
  }
  return published;
}

async function recalculate(
  transaction: Prisma.TransactionClient,
  subjectType: ReviewType,
  subjectId: string,
) {
  const subject =
    subjectType === ReviewType.VEHICLE
      ? { vehicleId: subjectId }
      : subjectType === ReviewType.OWNER
        ? { ownerProfileId: subjectId }
        : { subjectUserId: subjectId };
  const aggregate = await transaction.review.aggregate({
    _avg: { rating: true },
    _count: { rating: true },
    _sum: { rating: true },
    where: {
      ...subject,
      moderationStatus: ReviewModerationStatus.PUBLISHED,
      publicationStatus: ReviewPublicationStatus.PUBLISHED,
    },
  });
  await transaction.ratingProjection.upsert({
    create: {
      averageRating: aggregate._avg.rating ?? 0,
      ratingSum: aggregate._sum.rating ?? 0,
      reviewCount: aggregate._count.rating,
      subjectId,
      subjectType,
    },
    update: {
      averageRating: aggregate._avg.rating ?? 0,
      ratingSum: aggregate._sum.rating ?? 0,
      recalculatedAt: new Date(),
      reviewCount: aggregate._count.rating,
    },
    where: { subjectType_subjectId: { subjectId, subjectType } },
  });
}
