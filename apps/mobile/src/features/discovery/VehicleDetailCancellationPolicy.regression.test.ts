import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cancellationPolicyDisclaimer,
  cancellationPolicyIntroduction,
  cancellationPolicySections,
} from './cancellation-policy-content';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const detail = source.slice(
  source.indexOf('function VehicleView'),
  source.indexOf('function QuoteCard'),
);
const policyCopy = [
  cancellationPolicyIntroduction,
  ...cancellationPolicySections.flatMap((section) => [section.title, ...section.paragraphs]),
  cancellationPolicyDisclaimer,
].join(' ');

describe('Task 17F Vehicle Detail cancellation policy presentation', () => {
  it('opens an accessible informational page sheet from Things to know and can close it', () => {
    const thingsToKnow = detail.slice(
      detail.indexOf('title="Things to know"'),
      detail.indexOf('title="Rental requirements"'),
    );
    expect(thingsToKnow).toContain('title="Cancellation policy"');
    expect(thingsToKnow).toContain('onPress={() => setCancellationPolicyOpen(true)}');
    expect(detail).toContain('presentationStyle="pageSheet"');
    expect(detail).toContain('visible={cancellationPolicyOpen}');
    expect(detail).toContain('label="Close"');
    expect(detail).toContain('onPress={() => setCancellationPolicyOpen(false)}');
    expect(detail).toContain('accessibilityRole="header"');
    expect(source).toContain('accessibilityHint="Opens the renter cancellation policy"');
    expect(source).toContain('accessibilityRole="button"');
    expect(detail).not.toContain('Cancel booking');
  });

  it('truthfully explains advance and last-minute booking rules without promising free cancellation', () => {
    expect(policyCopy).toContain('at least 72 hours before pickup');
    expect(policyCopy).toContain('Before the final 72-hour window');
    expect(policyCopy).toContain("minus CarShare's booking commission");
    expect(policyCopy).toContain('At or inside the final 72 hours before pickup');
    expect(policyCopy).toContain('less than 72 hours before pickup');
    expect(policyCopy).toContain('six-hour cancellation grace period after confirmation');
    expect(policyCopy).toContain('never extends beyond pickup or custody');
    expect(policyCopy.toLowerCase()).not.toContain('free cancellation');
  });

  it('describes component-level non-refundability, fulfillment, and the after-pickup boundary', () => {
    expect(policyCopy).toContain('rental portion is non-refundable');
    expect(policyCopy).toContain(
      "If a delivery or collection service hasn't been completed, its fee may still be refundable even when the rental itself is non-refundable.",
    );
    expect(policyCopy).not.toMatch(
      /authoritative evidence|cancellation settlement|service-state authority|reconciliation/i,
    );
    expect(policyCopy).toContain(
      'Ordinary booking cancellation is available only before pickup or custody',
    );
    expect(policyCopy).toContain('return, claim, dispute, incident, or support process');
  });

  it('delegates exact refunds to cancellation preview and contains no policy calculation or Owner penalties', () => {
    expect(policyCopy).toContain(
      'The exact refund for an existing booking is shown before you confirm cancellation',
    );
    expect(policyCopy).toContain('not a live refund quote');
    expect(policyCopy).not.toMatch(/owner penalty|future eligible earnings|payout recovery/i);

    const contentSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'cancellation-policy-content.ts'),
      'utf8',
    );
    expect(contentSource).not.toMatch(
      /Date\.|differenceIn|addHours|subtract|amountMinor|calculate/i,
    );
  });
});
