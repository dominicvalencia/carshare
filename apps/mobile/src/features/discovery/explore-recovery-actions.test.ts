import { describe, expect, it } from 'vitest';
import type { BookingView } from '../bookings/MyBookingsScreen';
import {
  pendingExploreRecoveryActions,
  recoveryActionCountLabel,
  recoveryActionScopeLabel,
  unseenRecoveryActions,
} from './explore-recovery-actions';

function booking(
  reference: string,
  scope: 'START' | 'RETURN' | 'BOTH',
  response: NonNullable<BookingView['overdueHandoverRecovery']>['response'] = null,
  status = 'ACTIVE',
): BookingView {
  return {
    publicReference: reference,
    status,
    overdueHandoverRecovery: {
      scope,
      responseDeadlineAt: '2026-09-22T10:00:00.000Z',
      response,
      acceptance: null,
    },
  } as BookingView;
}

describe('Explore handover action presentation', () => {
  it('counts only actual unanswered, nonterminal reports', () => {
    const actions = pendingExploreRecoveryActions([
      booking('PICKUP', 'START'),
      booking('RETURN', 'RETURN'),
      booking('BOTH', 'BOTH'),
      booking('DISPUTED', 'START', { decision: 'DISPUTED' }),
      booking('CONFIRMED', 'RETURN', { decision: 'CONFIRMED' }),
      booking('CLOSED', 'START', null, 'COMPLETED'),
      { ...booking('ACCEPTED', 'START'), overdueHandoverRecovery: null },
    ]);
    expect(actions.map(({ reference }) => reference)).toEqual(['PICKUP', 'RETURN', 'BOTH']);
    expect(actions.map(({ scope }) => recoveryActionScopeLabel(scope))).toEqual([
      'Pickup handover',
      'Return handover',
      'Pickup and Return handovers',
    ]);
    expect(recoveryActionCountLabel(actions.length)).toBe('3 actions require your response');
    expect(recoveryActionCountLabel(1)).toBe('1 action requires your response');
    expect(pendingExploreRecoveryActions([])).toEqual([]);
  });

  it('auto-presents a new report once per mounted session key, including a later new report', () => {
    const first = pendingExploreRecoveryActions([booking('FIRST', 'START')]);
    const seen = new Set<string>();
    expect(unseenRecoveryActions(first, seen)).toBe(true);
    first.forEach(({ key }) => seen.add(key));
    expect(unseenRecoveryActions(first, seen)).toBe(false);
    const later = pendingExploreRecoveryActions([
      booking('FIRST', 'START'),
      booking('SECOND', 'RETURN'),
    ]);
    expect(unseenRecoveryActions(later, seen)).toBe(true);
  });
});
