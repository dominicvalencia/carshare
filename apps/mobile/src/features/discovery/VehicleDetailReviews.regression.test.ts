import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const reviewService = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../api/src/reviews/reviews.service.ts',
  ),
  'utf8',
);
const detail = source.slice(
  source.indexOf('function VehicleView'),
  source.indexOf('function QuoteCard'),
);
const reviewsStart = detail.indexOf("? 'Reviews'");
const reviews = detail.slice(
  reviewsStart,
  detail.indexOf('</View>', detail.indexOf('</View>', reviewsStart) + 1),
);

describe('Task 14D-3 Vehicle Detail review preview', () => {
  it('uses aggregate vehicle rating and correct zero/one/multiple wording', () => {
    expect(detail).toContain('vehicle.rating?.averageRating && vehicle.rating.reviewCount > 0');
    expect(detail).toContain("vehicle.rating.reviewCount === 1 ? 'review' : 'reviews'");
    expect(detail).toContain("'Reviews'");
    expect(detail).toContain('No reviews yet');
  });

  it('requests only two published vehicle reviews with an isolated cache key', () => {
    expect(detail).toContain("queryKey: ['public-review-preview', vehicle?.vehicleId, 2]");
    expect(detail).toContain('`/vehicles/${vehicle!.vehicleId}/reviews?limit=2`');
    expect(detail).not.toContain('/hosts/${vehicle!.owner.publicReference}/reviews?limit=2');
  });

  it('preserves the endpoint public moderation and newest-first ordering', () => {
    expect(reviewService).toContain('moderationStatus: ReviewModerationStatus.PUBLISHED');
    expect(reviewService).toContain('publicationStatus: ReviewPublicationStatus.PUBLISHED');
    expect(reviewService).toContain("orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]");
    expect(reviewService).toContain('const items = rows.slice(0, query.limit)');
  });

  it('shows safe reviewer fields, explicit rating, original text, and date', () => {
    expect(detail).toContain("review.author.profile?.firstName ?? 'Guest'");
    expect(detail).toContain('Rated {review.rating} out of 5');
    expect(detail).toContain('text={review.text}');
    expect(detail).toContain('dateTimeLabel(review.createdAt)');
    expect(reviews).not.toMatch(/lastName|email|phone/);
  });

  it('expands long original review text without rewriting it', () => {
    expect(detail).toContain('accessibilityLabel={`full review by ${reviewer}`}');
    expect(detail).toContain('compactLength={180}');
    expect(detail).toContain("expanded ? 'Show less' : 'Show more'");
  });

  it('keeps full vehicle-review navigation truthful for one or additional reviews', () => {
    expect(detail).toContain('`Read all ${vehicle.rating.reviewCount} reviews`');
    expect(detail).toContain("? 'View review'");
    expect(detail).toContain('`View ${vehicle.rating.reviewCount} reviews`');
    expect(detail).toContain("navigation.navigate('PublicReviews'");
    expect(detail).toContain('path: `/vehicles/${vehicle.vehicleId}/reviews`');
  });

  it('isolates preview loading and failure from the Detail presentation', () => {
    expect(detail).toContain('Loading review preview…');
    expect(detail).toContain(
      'Review preview is unavailable. You can still open all published reviews.',
    );
    expect(detail).toContain('onPress={openReviews}');
  });
});
