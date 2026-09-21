import type { BookingView } from '../bookings/MyBookingsScreen';

export interface ExploreRecoveryAction {
  readonly reference: string;
  readonly scope: 'START' | 'RETURN' | 'BOTH';
  readonly responseDeadlineAt: string;
  readonly key: string;
}

export function pendingExploreRecoveryActions(
  bookings: readonly BookingView[],
): ExploreRecoveryAction[] {
  return bookings
    .filter(
      (booking) =>
        booking.overdueHandoverRecovery !== null &&
        booking.overdueHandoverRecovery.response === null &&
        booking.overdueHandoverRecovery.acceptance === null &&
        !['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(booking.status),
    )
    .map((booking) => {
      const recovery = booking.overdueHandoverRecovery!;
      return {
        reference: booking.publicReference,
        scope: recovery.scope,
        responseDeadlineAt: recovery.responseDeadlineAt,
        key: `${booking.publicReference}:${recovery.scope}:${recovery.responseDeadlineAt}`,
      };
    })
    .sort(
      (left, right) =>
        new Date(left.responseDeadlineAt).getTime() - new Date(right.responseDeadlineAt).getTime(),
    );
}

export function recoveryActionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'action requires' : 'actions require'} your response`;
}

export function recoveryActionScopeLabel(scope: ExploreRecoveryAction['scope']): string {
  return scope === 'START'
    ? 'Pickup handover'
    : scope === 'RETURN'
      ? 'Return handover'
      : 'Pickup and Return handovers';
}

export function unseenRecoveryActions(
  actions: readonly ExploreRecoveryAction[],
  seenKeys: ReadonlySet<string>,
): boolean {
  return actions.some((action) => !seenKeys.has(action.key));
}
