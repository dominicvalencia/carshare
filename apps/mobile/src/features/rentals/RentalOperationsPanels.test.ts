import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'RentalOperationsPanels.tsx'),
  'utf8',
);
const photoSlotSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/SecureCameraPhotoSlot.tsx'),
  'utf8',
);

describe('inspection correction mobile synchronization', () => {
  it('sends the authoritative proposal field and prevents another pending prompt', () => {
    expect(source).toContain('proposedOdometerMeters');
    expect(source).not.toContain('correctedOdometerMeters');
    expect(source).toContain('Correction requested · Pending admin review');
  });
  it('polls open rental details and displays approved/rejected outcomes', () => {
    expect(source).toContain("['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING']");
    expect(source).toContain('✓ Correction approved');
    expect(source).toContain('Correction rejected');
    expect(source).toContain('Pickup inspection corrected');
  });
  it('previews captured and persisted evidence while keeping normal handovers asymmetric', () => {
    expect(source).toContain('SecureCameraPhotoSlot');
    expect(photoSlotSource).toContain('Captured and securely uploaded');
    expect(photoSlotSource).toContain("hasPreview ? 'Retake' : 'Open camera'");
    expect(source).toContain("mode: 'append' | 'replace'");
    expect(source.match(/<SecureCameraPhotoSlot/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('/pickup/inspection/draft/media');
    expect(source).toContain('owner-pickup-inspection-draft');
    expect(source).toContain('CapturedPreviews');
    expect(source).toContain('AuthorizedInspectionImage');
    expect(source).toContain('/access-grants');
    expect(source).toContain('Pickup inspection · Submitted by owner');
    expect(source).toContain('Return evidence · Submitted by renter');
    expect(source).not.toContain('Submit receipt inspection');
    expect(source).toContain('Everything looks correct');
    expect(source).toContain('Report a discrepancy');
  });
});
