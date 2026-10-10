import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Phase 13B shared native UI architecture', () => {
  it('uses shared booking-time selection and native owner availability controls', () => {
    const discovery = source('features/discovery/DiscoveryScreen.tsx');
    const bookingSummary = source('features/discovery/BookingDateTimeEditorSummary.tsx');
    const bookingTime = source('features/discovery/BookingTimeSelector.tsx');
    const vehicles = source('features/vehicles/VehiclesScreen.tsx');
    const dateTime = source('ui/DateTimeField.tsx');
    expect(discovery).toContain('<BookingDateTimeEditorSummary');
    expect(bookingSummary).toContain('<BookingTimeSelector');
    expect(bookingTime).toContain('<DateTimeField');
    expect(bookingTime).toContain('minuteInterval={BOOKING_TIME_INCREMENT_MINUTES}');
    expect(bookingTime).toContain('The same time applies to pickup and return.');
    expect(vehicles.match(/<DateTimeField/g)?.length).toBeGreaterThanOrEqual(2);
    expect(dateTime).toContain('Keyboard.dismiss()');
    expect(dateTime).toContain('mode="date"');
    expect(dateTime).toContain('mode="time"');
    expect(dateTime.match(/display="spinner"/g)).toHaveLength(2);
    expect(dateTime.match(/themeVariant="light"/g)).toHaveLength(2);
  });

  it('centralizes visible placeholders and active-role notification queries', () => {
    expect(source('theme/tokens.ts')).toContain("placeholder: '#69766F'");
    expect(source('ui/primitives.tsx')).toContain('placeholderTextColor={colors.placeholder}');
    expect(source('features/notifications/NotificationCenter.tsx')).toContain(
      'audience=${mode.toUpperCase()}',
    );
    expect(source('features/notifications/NotificationCenter.tsx')).toContain(
      'useRefreshOnFocusAndForeground(() => void notifications.refetch())',
    );
    expect(source('features/notifications/NotificationCenter.tsx')).toContain(
      "refetchOnMount: 'always'",
    );
    expect(source('navigation/AppNavigation.tsx')).toContain("['notification-summary', mode]");
  });
});
