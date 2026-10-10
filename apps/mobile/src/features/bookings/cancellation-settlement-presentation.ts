export interface CancellationSettlementPresentation {
  readonly collectionRefundedMinor: string;
  readonly commissionRetainedMinor: string;
  readonly deliveryRefundedMinor: string;
  readonly deliveryRetainedMinor: string;
}

export interface CancellationSettlementRow {
  readonly amountMinor: number;
  readonly icon: 'navigate-outline' | 'receipt-outline' | 'return-down-back-outline';
  readonly label: string;
}

export function cancellationSettlementRows(
  settlement: CancellationSettlementPresentation,
): readonly CancellationSettlementRow[] {
  return [
    {
      amountMinor: Number(settlement.commissionRetainedMinor),
      icon: 'receipt-outline' as const,
      label: 'CarShare fee retained',
    },
    {
      amountMinor: Number(settlement.deliveryRetainedMinor),
      icon: 'navigate-outline' as const,
      label: 'Delivery fee retained',
    },
    {
      amountMinor: Number(settlement.deliveryRefundedMinor),
      icon: 'navigate-outline' as const,
      label: 'Delivery fee refunded',
    },
    {
      amountMinor: Number(settlement.collectionRefundedMinor),
      icon: 'return-down-back-outline' as const,
      label: 'Collection fee refunded',
    },
  ].filter(({ amountMinor }) => Number.isFinite(amountMinor) && amountMinor !== 0);
}
