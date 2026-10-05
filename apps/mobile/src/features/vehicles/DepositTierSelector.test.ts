import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';

const here = dirname(fileURLToPath(import.meta.url));
const selectorSource = readFileSync(resolve(here, './DepositTierSelector.tsx'), 'utf8');
const searchableSource = readFileSync(
  resolve(here, '../../ui/SearchableReferenceSelector.tsx'),
  'utf8',
);
const vehiclesSource = readFileSync(resolve(here, './VehiclesScreen.tsx'), 'utf8');

describe('deposit tier selector', () => {
  it('renders server-projected tiers directly without adding search to this sheet', () => {
    expect(vehiclesSource).toContain('options={allowedDepositTiers.map((amountMinor) => ({');
    expect(selectorSource).not.toContain('TextInput');
    expect(selectorSource).not.toContain('Search');
    expect(searchableSource).toContain('<TextInput');
  });

  it('fits short content intrinsically and caps long content with scrolling', () => {
    const compact = adaptiveSheetLayout({
      contentHeight: 360,
      headerHeight: 0,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 0,
    });
    const long = adaptiveSheetLayout({
      contentHeight: 1_200,
      headerHeight: 0,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 0,
    });

    expect(compact).toEqual({ height: 360, intrinsicHeight: 360, scrollEnabled: false });
    expect(long).toEqual({ height: 780, intrinsicHeight: 1_200, scrollEnabled: true });
  });

  it('remeasures dynamic content and viewport changes', () => {
    expect(selectorSource).toContain('onContentSizeChange={(_width, height) =>');
    expect(selectorSource).toContain('const { height: viewportHeight } = useWindowDimensions();');
    expect(selectorSource).toContain('[maximumHeight, measuredContentHeight]');
    expect(selectorSource).toContain('options, sheetHeight, viewportHeight');
    expect(selectorSource).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
  });

  it('exposes selected tier state and a safe reachable Cancel action', () => {
    expect(selectorSource).toContain('accessibilityRole="header"');
    expect(selectorSource).toContain('accessibilityRole="radio"');
    expect(selectorSource).toContain('accessibilityState={{ checked }}');
    expect(selectorSource).toContain('name="checkmark-circle"');
    expect(selectorSource).toContain(
      '<Button label="Cancel" onPress={close} variant="secondary" />',
    );
    expect(selectorSource).toContain('paddingBottom: bottomAllowance');
    expect(selectorSource.match(/label="Cancel"/g)).toHaveLength(1);
  });
});
