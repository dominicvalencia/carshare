import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'booking-projection.service.ts'),
  'utf8',
);
const subjectReviews = source.slice(
  source.indexOf('subjectReviews:'),
  source.indexOf('verifications:', source.indexOf('subjectReviews:')),
);

describe('Owner booking renter-rating publication safety', () => {
  it('requires both moderation and double-blind publication before including renter reviews', () => {
    expect(subjectReviews).toContain("moderationStatus: 'PUBLISHED'");
    expect(subjectReviews).toContain("publicationStatus: 'PUBLISHED'");
    expect(subjectReviews).toContain("type: 'RENTER'");
  });
});
