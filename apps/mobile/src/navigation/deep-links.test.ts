import { describe, expect, it } from 'vitest';
import { internalDestination, isSafeRecoveryDeepLink } from './deep-links';

describe('notification deep-link routing', () => {
  it.each([
    ['carrental://bookings/booking-ref', { name: 'Booking', params: { bookingId: 'booking-ref' } }],
    [
      'carrental://bookings/DEMO-OVERDUE-RETURN/handover-recovery',
      { name: 'BookingRecovery', params: { bookingId: 'DEMO-OVERDUE-RETURN' } },
    ],
    [
      'carrental://messages/conversation-id',
      { name: 'Conversation', params: { conversationId: 'conversation-id' } },
    ],
    ['carrental://claims/claim-id', { name: 'Claim', params: { claimId: 'claim-id' } }],
    ['carrental://support/ticket-id', { name: 'Support', params: { ticketId: 'ticket-id' } }],
    ['carrental://earnings', { name: 'OwnerEarnings' }],
    ['carrental://payouts/payout-id', { name: 'Payout', params: { payoutId: 'payout-id' } }],
    [
      'carrental://owner/vehicle-approvals/vehicle-id',
      { name: 'OwnerVehicleApproval', params: { vehicleId: 'vehicle-id' } },
    ],
    [
      'carrental://owner/vehicle-change-proposals/vehicle-id/proposal-id',
      {
        name: 'OwnerVehicleChangeProposal',
        params: { proposalId: 'proposal-id', vehicleId: 'vehicle-id' },
      },
    ],
    [
      'carrental://owner/vehicles/vehicle-id',
      { name: 'OwnerWorkspaceVehicle', params: { vehicleId: 'vehicle-id' } },
    ],
  ])('maps %s to an in-app destination', (link, expected) => {
    expect(internalDestination(link)).toEqual(expected);
  });

  it('allowlists only public-reference recovery routes without query secrets', () => {
    expect(
      isSafeRecoveryDeepLink('carrental://bookings/DEMO-OVERDUE-RETURN/handover-recovery'),
    ).toBe(true);
    expect(
      isSafeRecoveryDeepLink(
        'carrental://bookings/DEMO-OVERDUE-RETURN/handover-recovery?token=secret',
      ),
    ).toBe(false);
    expect(isSafeRecoveryDeepLink('https://example.com/bookings/DEMO/handover-recovery')).toBe(
      false,
    );
  });

  it('rejects invalid or unsupported links without exposing a raw OS error', () => {
    expect(internalDestination('https://example.com')).toBeNull();
    expect(internalDestination('carrental://unknown/value')).toBeNull();
  });
});
