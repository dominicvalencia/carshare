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

  it('projects only the authoritative READY profile avatar to the booking owner', () => {
    expect(source).toContain(
      'avatarFile: { select: { classification: true, id: true, status: true } }',
    );
    expect(source).toContain("definition: { code: 'PROFILE_PHOTO' }");
    expect(source).toContain('replacedAt: null');
    expect(source).toContain(
      'booking.renter.verifications.flatMap(({ documents }) => documents)[0]?.fileAsset',
    );
    expect(source).toContain('avatar?.status === FileAssetStatus.READY');
    expect(source).toContain('this.files.trustedAuthorizedGrant(avatar.id)');
    expect(source).not.toContain('SELFIE_WITH_LICENSE');
  });
});
