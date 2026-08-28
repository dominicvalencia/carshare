import { describe, expect, it } from 'vitest';
import { internalDestination } from './deep-links';

describe('notification deep-link routing', () => {
  it.each([
    ['carrental://bookings/booking-ref', { name: 'Booking', params: { bookingId: 'booking-ref' } }],
    [
      'carrental://messages/conversation-id',
      { name: 'Conversation', params: { conversationId: 'conversation-id' } },
    ],
    ['carrental://claims/claim-id', { name: 'Claim', params: { claimId: 'claim-id' } }],
    ['carrental://support/ticket-id', { name: 'Support', params: { ticketId: 'ticket-id' } }],
    ['carrental://earnings', { name: 'OwnerEarnings' }],
    ['carrental://payouts/payout-id', { name: 'Payout', params: { payoutId: 'payout-id' } }],
  ])('maps %s to an in-app destination', (link, expected) => {
    expect(internalDestination(link)).toEqual(expected);
  });

  it('rejects invalid or unsupported links without exposing a raw OS error', () => {
    expect(internalDestination('https://example.com')).toBeNull();
    expect(internalDestination('carrental://unknown/value')).toBeNull();
  });
});
