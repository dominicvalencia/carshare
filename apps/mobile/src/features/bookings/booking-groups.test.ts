import { describe, expect, it } from 'vitest';
import { bookingGroup } from './booking-presentation';

describe('renter booking information architecture', () => {
  it.each(['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED'])(
    'maps %s to Current',
    (status) => expect(bookingGroup(status)).toBe('Current'),
  );

  it.each(['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER', 'CAPTURE_PENDING', 'CONFIRMED'])(
    'maps %s to Upcoming',
    (status) => expect(bookingGroup(status)).toBe('Upcoming'),
  );

  it.each(['COMPLETED', 'CANCELLED', 'EXPIRED'])('maps %s to Past', (status) =>
    expect(bookingGroup(status)).toBe('Past'),
  );
});
