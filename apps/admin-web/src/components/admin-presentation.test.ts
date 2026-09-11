import { describe, expect, it } from 'vitest';
import {
  adminLabel,
  formatBasisPoints,
  formatMoney,
  marketplaceRoleLabel,
  visibilityReason,
} from './admin-presentation';

describe('Admin presentation language', () => {
  it('maps backend status and event codes to operator-facing labels', () => {
    expect(adminLabel('PENDING_APPROVAL')).toBe('Pending review');
    expect(adminLabel('RETURN_PENDING')).toBe('Return awaiting confirmation');
    expect(adminLabel('TOKEN_REFRESH')).toBe('Session refreshed');
    expect(adminLabel('INTERIOR_DASHBOARD')).toBe('Interior / dashboard');
  });

  it('distinguishes marketplace Vehicle Owner capability from administrative Owner', () => {
    expect(marketplaceRoleLabel('RENTER')).toBe('Renter');
    expect(marketplaceRoleLabel('OWNER')).toBe('Vehicle Owner');
  });

  it('formats financial and inspection values for primary presentation', () => {
    expect(formatMoney(210_000)).toContain('2,100.00');
    expect(formatBasisPoints(7_500)).toBe('75%');
  });

  it('explains public discovery blockers without raw enum copy', () => {
    expect(visibilityReason('PUBLIC_COVER_PHOTO_MISSING')).toBe('Public cover photo missing');
    expect(visibilityReason('REQUIRED_DOCUMENT_INVALID')).toBe(
      'Required vehicle document needs review',
    );
  });
});
