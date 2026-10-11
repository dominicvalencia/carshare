import { describe, expect, it } from 'vitest';
import { staffInvitationLink } from './staff-invitation-link';

describe('Staff invitation deep links', () => {
  it('extracts an opaque token only from the configured app route', () => {
    expect(staffInvitationLink('carrental://owner/staff-invitation?token=opaque')).toEqual({
      matched: true,
      token: 'opaque',
    });
    expect(staffInvitationLink('https://example.test/owner/staff-invitation?token=opaque')).toEqual(
      {
        matched: false,
      },
    );
  });

  it('marks malformed invitation links without exposing a token', () => {
    expect(staffInvitationLink('carrental://owner/staff-invitation')).toEqual({ matched: true });
  });
});
