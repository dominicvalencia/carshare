import { describe, expect, it } from 'vitest';
import { currentOverdueHandoverRecovery } from './rentals.service';

describe('overdue handover recovery projection', () => {
  it('projects the unresolved recovery used by the mobile post-submit state', () => {
    const accepted = { acceptance: { acceptedAt: '2026-10-09T00:00:00.000Z' }, id: 'accepted' };
    const pending = { acceptance: null, id: 'pending' };

    expect(currentOverdueHandoverRecovery([accepted, pending])).toBe(pending);
  });

  it('keeps a disputed recovery current until Operations resolves it', () => {
    const disputed = { acceptance: null, id: 'disputed', response: { decision: 'DISPUTED' } };

    expect(currentOverdueHandoverRecovery([disputed])).toBe(disputed);
  });

  it('retains the latest accepted recovery as historical context', () => {
    const accepted = { acceptance: { acceptedAt: '2026-10-10T00:00:00.000Z' }, id: 'accepted' };

    expect(currentOverdueHandoverRecovery([accepted])).toBe(accepted);
    expect(currentOverdueHandoverRecovery([])).toBeNull();
  });
});
