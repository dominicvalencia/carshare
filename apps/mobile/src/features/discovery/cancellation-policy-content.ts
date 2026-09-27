export interface CancellationPolicySection {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const cancellationPolicyIntroduction =
  'Cancellation timing and the booking commission affect what can be refunded.';

export const cancellationPolicySections: readonly CancellationPolicySection[] = [
  {
    title: 'Bookings confirmed at least 72 hours before pickup',
    paragraphs: [
      "Before the final 72-hour window, you may cancel and receive a refund minus CarShare's booking commission.",
      'At or inside the final 72 hours before pickup, the rental portion is non-refundable.',
    ],
  },
  {
    title: 'Bookings confirmed less than 72 hours before pickup',
    paragraphs: [
      'You have a six-hour cancellation grace period after confirmation, provided pickup or custody has not started.',
      "During that grace period, the eligible amount is refunded minus CarShare's booking commission. After the grace period, the rental portion is non-refundable. The grace period never extends beyond pickup or custody.",
    ],
  },
  {
    title: 'Delivery and collection',
    paragraphs: [
      "If a delivery or collection service hasn't been completed, its fee may still be refundable even when the rental itself is non-refundable.",
    ],
  },
  {
    title: 'After pickup',
    paragraphs: [
      'Ordinary booking cancellation is available only before pickup or custody. Once the trip has started, use the appropriate return, claim, dispute, incident, or support process.',
    ],
  },
] as const;

export const cancellationPolicyDisclaimer =
  'The exact refund for an existing booking is shown before you confirm cancellation. This information is not a live refund quote.';
