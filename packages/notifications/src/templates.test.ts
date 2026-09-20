import { describe, expect, it } from 'vitest';
import { renderNotification } from './templates';

describe('overdue reminder content', () => {
  it.each([
    ['START', 'Confirm Pickup handover', 'Pickup report'],
    ['RETURN', 'Confirm Return handover', 'Return report'],
    ['BOTH', 'Confirm Pickup and Return', 'Pickup and Return report'],
  ])('renders scope-aware recovery push for %s', (scope, title, body) => {
    const content = renderNotification('rental.overdue-recovery-reported', {
      scope,
      reference: 'DEMO-OVERDUE',
      code: '123456',
      privateAddress: 'secret address',
    });
    expect(content.title).toContain(title);
    expect(content.body).toContain(body);
    expect(JSON.stringify(content)).not.toContain('123456');
    expect(JSON.stringify(content)).not.toContain('secret address');
  });

  it.each([
    'rental.handover-overdue.owner',
    'rental.handover-overdue.renter',
    'rental.return-overdue.owner',
    'rental.return-overdue.renter',
  ])('renders %s without OTP or private addresses', (key) => {
    const content = renderNotification(key, { code: '123456', privateAddress: 'secret address' });
    expect(content.title).toContain('overdue');
    expect(JSON.stringify(content)).not.toContain('123456');
    expect(JSON.stringify(content)).not.toContain('secret address');
    expect(content.body).not.toContain('automatically');
  });
});
