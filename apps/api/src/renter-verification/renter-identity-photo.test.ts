import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(resolve(directory, 'renter-verification.service.ts'), 'utf8');
const migration = readFileSync(
  resolve(
    directory,
    '../../../../packages/database/prisma/migrations/20261008100000_renter_identity_photo_requirements/migration.sql',
  ),
  'utf8',
);

describe('renter identity-photo authority', () => {
  it('preserves legacy selfie evidence while adding the second required type', () => {
    expect(migration).toContain('"code" = \'PROFILE_PHOTO\'');
    expect(migration).toContain('AND "code" = \'SELFIE\'');
    expect(migration).toContain("'SELFIE_WITH_LICENSE'");
    expect(migration).toContain("'IDENTITY_PHOTO'");
    expect(migration).not.toContain('DELETE FROM');
  });

  it('uses only profile-photo evidence as the avatar source', () => {
    expect(service).toContain("definition.code === 'PROFILE_PHOTO'");
    expect(service).toContain('update: { avatarFileId: file.id }');
    expect(service).not.toContain("definition.code === 'SELFIE_WITH_LICENSE'");
  });

  it('keeps both image types in the sensitive verification upload path', () => {
    expect(service).toContain('file.classification !== FileClassification.SENSITIVE');
    expect(service).toContain('definition.required && !documentCodes.has(definition.code)');
  });
});
