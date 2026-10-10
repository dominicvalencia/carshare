import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exploreEmptyStateCopy } from './explore-empty-state';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);

describe('Explore results empty state', () => {
  it('uses contextual headings without overstating fallback location knowledge', () => {
    expect(
      exploreEmptyStateCopy({ datesSelected: true, locationSource: 'DEVICE_LOCATION' }),
    ).toEqual({
      title: 'No cars nearby',
      message: 'Try another area, adjust your dates, or broaden your filters.',
    });
    expect(exploreEmptyStateCopy({ datesSelected: true, locationSource: 'USER_SELECTED' })).toEqual(
      {
        title: 'No cars found in this area',
        message: 'Try another location, adjust your dates, or broaden your filters.',
      },
    );
    expect(exploreEmptyStateCopy({ datesSelected: true, locationSource: 'FALLBACK' })).toEqual({
      title: 'No cars found',
      message: 'Try another location, adjust your dates, or broaden your filters.',
    });
  });

  it('prioritizes adding dates when no trip dates were explicitly selected', () => {
    expect(
      exploreEmptyStateCopy({ datesSelected: false, locationSource: 'DEVICE_LOCATION' }).message,
    ).toBe('Try another area or add trip dates to find available cars.');
  });

  it('keeps loading and errors ahead of the list empty component', () => {
    const loading = source.indexOf('listSearch.isPending ?');
    const error = source.indexOf('listSearch.isError && searchItems.length === 0 ?');
    const empty = source.indexOf('<ExploreEmptyState');
    expect(loading).toBeGreaterThan(-1);
    expect(error).toBeGreaterThan(loading);
    expect(empty).toBeGreaterThan(error);
    expect(source).toContain('title="Search unavailable"');
    expect(source).toContain('onAction={() => void listSearch.refetch()}');
  });

  it('covers the Explore home rails after their loading and error states settle', () => {
    expect(source).toContain('const homeExploreItemCount = [');
    expect(source).toContain('const homeExploreLoading =');
    expect(source).toContain('const homeExploreError =');
    const homeEmpty = source.indexOf('homeExploreItemCount === 0 ? (');
    expect(homeEmpty).toBeGreaterThan(source.indexOf('homeExploreLoading ? ('));
    expect(homeEmpty).toBeGreaterThan(source.indexOf('homeExploreError ? ('));
    expect(source.slice(homeEmpty, homeEmpty + 700)).toContain('<ExploreEmptyState');
    expect(source).toContain('title="Explore unavailable"');
  });

  it('keeps location recovery in the existing sheet and dates in the top search pill', () => {
    expect(source).toContain("setSearchSheetInitialSection('location')");
    expect(source).toContain("setSearchSheetInitialSection('dates')");
    expect(source).toContain('initialSection={searchSheetInitialSection}');
    expect(source).toContain("initialSection === 'dates'");
    expect(source).toContain("initialSection === 'location'");
    expect(source).toContain('onChangeLocation={openExploreLocation}');
    expect(source).not.toContain('onAdjustDates=');
    expect(source).not.toContain('label="Adjust dates"');
    expect(source).toContain('accessibilityLabel={`Trip dates and time, ${tripDateTimeSummary');
    expect(source).toContain('onPress={openExploreDates}');
  });

  it('renders the empty content on a restrained white surface', () => {
    expect(source).toMatch(
      /exploreEmptyRegion: \{[\s\S]*alignItems: 'center',[\s\S]*flex: 1,[\s\S]*justifyContent: 'center'/,
    );
    expect(source).toMatch(
      /exploreEmptyState: \{[\s\S]*backgroundColor: colors\.surface,[\s\S]*borderColor: colors\.border,[\s\S]*borderRadius: radius\.lg/,
    );
  });

  it('shows filter clearing only when active and preserves location and dates', () => {
    expect(source).toContain('filtersActive={resultsFilterCount > 0}');
    expect(source).toContain('{filtersActive ? (');
    expect(source).toContain('label="Clear filters"');
    const clear = source.slice(
      source.indexOf('function clearResultsFilters()'),
      source.indexOf('const committedFilters'),
    );
    expect(clear).toContain('DEFAULT_DISCOVERY_FILTERS');
    expect(clear).not.toContain('setPlace(');
    expect(clear).not.toContain('setActivePlace(');
    expect(clear).not.toContain('setPickup(');
    expect(clear).not.toContain('setReturnAt(');
  });

  it('does not change the server search query authority', () => {
    expect(source).toContain("queryKey: ['public-search', 'LIST', listQueryString]");
    expect(source).toContain('`/vehicles/search?${listQueryString}');
    expect(source).toContain("queryKey: ['public-search', 'MAP', mapQueryString]");
  });
});
