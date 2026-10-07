import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptiveSheetLayout } from './adaptive-sheet-layout';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, './SearchableReferenceSelector.tsx'), 'utf8');

describe('searchable reference selector sheet', () => {
  it('fits short content intrinsically and caps long content with scrolling', () => {
    const compact = adaptiveSheetLayout({
      contentHeight: 332,
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

    expect(compact).toEqual({ height: 332, intrinsicHeight: 332, scrollEnabled: false });
    expect(long).toEqual({ height: 780, intrinsicHeight: 1_200, scrollEnabled: true });
    expect(source).toContain('setListContentHeight(height)');
    expect(source).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
  });

  it('remeasures for filtered content and viewport changes', () => {
    expect(source).toContain('const { height: viewportHeight } = useWindowDimensions();');
    expect(source).toContain('[footerHeight, headerHeight, listContentHeight, maximumHeight]');
    expect(source).toContain('filtered.length');
    expect(source).toContain('viewportHeight');
  });

  it('keeps search and whole-row option selection behavior', () => {
    expect(source).toContain('<TextInput');
    expect(source).toContain('onChangeText={setSearch}');
    expect(source).toContain('onPress={() => select(item.id)}');
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityState={{ checked }}');
  });

  it('uses the shared secondary button for an accessible dismiss action', () => {
    expect(source).toContain('<Button label="Cancel" onPress={close} variant="secondary" />');
    expect(source).toContain('const close = () =>');
    expect(source).toContain('setOpen(false)');
    expect(source).toContain('paddingBottom: bottomAllowance');
    expect(source).toContain('style={[styles.footer, { paddingBottom: bottomAllowance }]}');
    expect(source.indexOf('style={styles.list}')).toBeLessThan(source.indexOf('styles.footer'));
    expect(source).toContain('listContent: { flexGrow: 0, paddingBottom: spacing.sm }');
  });

  it('keeps keyboard-aware behavior within the safe viewport', () => {
    expect(source).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(source).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
    expect(source).toContain('Math.max(safeArea.bottom, spacing.lg)');
  });
});
