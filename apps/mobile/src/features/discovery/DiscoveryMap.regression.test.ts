import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mapSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryMap.tsx'),
  'utf8',
);
const screenSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);

describe('map discovery regression', () => {
  it('uses only privacy-safe map fields and keeps price pins accessible', () => {
    expect(mapSource).toContain('mapPosition.mapLatitude');
    expect(mapSource).toContain('mapPosition.mapLongitude');
    expect(mapSource).not.toContain('location.latitude');
    expect(mapSource).not.toContain('location.longitude');
    expect(mapSource).toContain('per day`');
    expect(mapSource).toContain('accessibilityState={{ selected: active }}');
  });

  it('clusters privacy-safe positions, zooms, and exposes a vehicle browser', () => {
    expect(mapSource).toContain('clusterMapItems(mapItems)');
    expect(mapSource).toContain('vehicles in this area');
    expect(mapSource).toContain('animateToRegion');
    expect(mapSource).toContain('cars in this area');
    expect(mapSource).toContain('View car');
    expect(mapSource).toContain(
      'setSelectedCluster({ items: cluster, dismissKey: transientUiDismissKey })',
    );
  });

  it('debounces user-driven area searches and suppresses programmatic loops', () => {
    expect(mapSource).toContain('onPanDrag');
    expect(mapSource).toContain('setTimeout(() =>');
    expect(mapSource).toContain('}, 800)');
    expect(mapSource).toContain('programmaticMove.current');
    expect(mapSource).toContain('Searching this area…');
    expect(mapSource).not.toContain("label={loading ? 'Searching…' : 'Search this area'}");
    expect(mapSource).not.toContain('onRegionChange=');
  });

  it('uses one shared criteria authority for simultaneous LIST and MAP projections', () => {
    expect(screenSource).toContain("query.set('handover', handover)");
    expect(screenSource).toContain("query.set('returnHandover', returnHandover)");
    expect(screenSource).toContain(
      'const listQueryString = `${activeCriteriaQueryString}&limit=10&mode=LIST`',
    );
    expect(screenSource).toContain(
      'const mapQueryString = `${activeCriteriaQueryString}&limit=50&mode=MAP`',
    );
    expect(screenSource).toContain("queryKey: ['public-search', 'LIST', listQueryString]");
    expect(screenSource).toContain("queryKey: ['public-search', 'MAP', mapQueryString]");
    expect(screenSource).toContain('setActivePlace(nextPlace)');
  });

  it('renders one accessible Map and FlatList composition without the legacy toggle', () => {
    const resultsStart = screenSource.indexOf("if (mode === 'results')");
    const resultsEnd = screenSource.indexOf('return (\n    <Screen', resultsStart);
    const results = screenSource.slice(resultsStart, resultsEnd);
    expect(results).toContain('accessibilityLabel="Approximate vehicle map region"');
    expect(results).toContain('<DiscoveryMap');
    expect(results).toContain("'Cars available results sheet'");
    expect(results).toContain('accessibilityLabel="Cars available vehicle list"');
    expect(results).toContain('<Reanimated.FlatList');
    expect(results).not.toContain('accessibilityLabel="Search result view"');
    expect(results).not.toContain('setPresentationMode');
  });

  it('uses a responsive map container and a noninteractive sheet handle', () => {
    expect(screenSource).toContain(
      'Math.max(220, Math.min(340, Math.round(viewportHeight * 0.34)))',
    );
    expect(screenSource).toContain('styles.resultsSheet');
    expect(screenSource).toContain('mapFullyCollapsed && styles.resultsSheetCollapsed');
    expect(screenSource).toContain('style={styles.resultsQuickFilterScroller}');
    expect(screenSource).toContain('resultsQuickFilterScroller: { flexGrow: 0, height: 48 }');
    expect(screenSource).toContain('importantForAccessibility="no"');
    expect(screenSource).toContain('scrollEventThrottle={16}');
  });

  it('commits user map areas to both projections and restarts LIST pagination', () => {
    expect(screenSource).toMatch(
      /function searchMapArea\(area: MapSearchArea\) \{[\s\S]*setActivePlace\(\(current\)[\s\S]*latitude: area\.latitude[\s\S]*longitude: area\.longitude[\s\S]*setActiveRadiusKm\(area\.radiusKm\)[\s\S]*resultScrollOffset\.current = 0/,
    );
    expect(screenSource).toContain('onSearchArea={searchMapArea}');
    expect(screenSource).not.toContain("label: 'Map area'");
  });

  it('keeps LIST pagination isolated from the capped MAP projection', () => {
    expect(screenSource).toContain('initialPageParam: null as string | null');
    expect(screenSource).toContain('getNextPageParam:');
    expect(screenSource).toContain('data={searchItems}');
    expect(screenSource).toContain('items={mapItems}');
    expect(screenSource).toContain('if (listSearch.hasNextPage && !listSearch.isFetchingNextPage)');
    expect(screenSource).not.toContain('mapSearch.fetchNextPage');
  });

  it('keeps projection loading, failure, and retry states independent', () => {
    expect(screenSource).toContain('error={mapSearch.isError ? mapSearch.error : null}');
    expect(screenSource).toContain('onRetry={() => void mapSearch.refetch()}');
    expect(screenSource).toContain('listSearch.isError && !listSearch.data');
    expect(screenSource).toContain('onAction={() => void listSearch.refetch()}');
  });

  it('preserves a complete List fallback, map errors, empty state, and privacy copy', () => {
    expect(screenSource).toContain('<Reanimated.FlatList');
    expect(mapSource).toContain('No cars found in this area');
    expect(mapSource).toContain('The map position is preserved. Try this search again.');
    expect(mapSource).toContain('Vehicle locations are approximate to protect owner privacy.');
  });
});

describe('Task 12A forward Results handoff regression', () => {
  it('separates responsive presentation collapse from observed list offset', () => {
    expect(screenSource).toContain('const collapseProgress = useSharedValue(0)');
    expect(screenSource).toContain('const observedListOffset = useSharedValue(0)');
    expect(screenSource).toMatch(
      /const mapCollapseDistance = Math\.max\(\s*190,\s*Math\.min\(280, initialResultsMapHeight \* 0\.85\)/,
    );
    expect(screenSource).toContain('initialResultsMapHeight * (1 - collapseProgress.value)');
    expect(screenSource).toContain('useAnimatedScrollHandler({');
    expect(screenSource).toContain('observedListOffset.value = Math.max(0, event.contentOffset.y)');
  });

  it('keeps one FlatList and performs only post-boundary UI-thread synthetic scrolling', () => {
    expect(screenSource).toContain('<Reanimated.FlatList');
    expect(screenSource).toContain('if (nextProgress < 1) return');
    expect(screenSource).toContain('scrollTo(resultListRef, 0, target, false)');
    expect(screenSource).toContain('resultScrollOffset.current = normalizedOffset');
    expect(screenSource).not.toContain('setMapHeight(');
    expect(screenSource).not.toContain('PanResponder');
  });

  it('removes hidden Map touch and accessibility interception', () => {
    expect(screenSource).toContain("pointerEvents={mapFullyCollapsed ? 'none' : 'auto'}");
    expect(screenSource).toContain('accessibilityElementsHidden={mapFullyCollapsed}');
    expect(screenSource).toContain(
      "importantForAccessibility={mapFullyCollapsed ? 'no-hide-descendants' : 'auto'}",
    );
    expect(screenSource).toMatch(
      /if \(transientUiDismissed\) \{[\s\S]*setSelectedMapVehicleId\(null\)/,
    );
    expect(screenSource).toContain('mapFullyCollapsed && styles.resultsSheetCollapsed');
  });

  it('fades the Map and decorative handle without creating another interaction', () => {
    expect(screenSource).toContain('const collapsedMapStyle = useAnimatedStyle(() => ({');
    expect(screenSource).toContain('const collapseHandleStyle = useAnimatedStyle(() => ({');
    expect(screenSource).toContain('style={[styles.resultsSheetHandle, collapseHandleStyle]}');
    expect(screenSource).not.toContain('label="Show map"');
  });

  it('dismisses transient marker and cluster UI after a meaningful scroll threshold', () => {
    expect(screenSource).toContain(
      'const mapTransientUiDismissOffset = Math.min(32, mapCollapseDistance * 0.15)',
    );
    expect(screenSource).toContain('setMapTransientUiDismissKey((key) => key + 1)');
    expect(screenSource).toContain('transientUiDismissKey={mapTransientUiDismissKey}');
    expect(mapSource).toContain('selectedCluster.dismissKey === transientUiDismissKey');
  });

  it('expands for new criteria but preserves collapse for pagination and retries', () => {
    expect(screenSource).toMatch(
      /function resetResultsViewport\(\{ preserveFullMap = false \} = \{\}\) \{[\s\S]*collapseProgress\.value = 0[\s\S]*setMapFullyCollapsed\(false\)/,
    );
    expect(screenSource).toMatch(
      /function performSearch\(draft\?: SearchDraft\)[\s\S]*resetResultsViewport\(\)/,
    );
    expect(screenSource).toMatch(
      /function prepareResultsFilterChange\(\) \{\s*resetResultsViewport\(\)/,
    );
    const paginationStart = screenSource.indexOf('onEndReached={() =>');
    const paginationEnd = screenSource.indexOf('onEndReachedThreshold', paginationStart);
    expect(screenSource.slice(paginationStart, paginationEnd)).not.toContain(
      'resetResultsViewport',
    );
  });

  it('does not couple scroll collapse to search criteria or Map camera commands', () => {
    const scrollStart = screenSource.indexOf('const onResultsScroll = useAnimatedScrollHandler(');
    const scrollEnd = screenSource.indexOf('const exploreScrollRef', scrollStart);
    const scrollHandler = screenSource.slice(scrollStart, scrollEnd);
    expect(scrollHandler).not.toContain('setActivePlace');
    expect(scrollHandler).not.toContain('setActiveRadiusKm');
    expect(scrollHandler).not.toContain('refetch');
    expect(scrollHandler).not.toContain('animateToRegion');
  });
});

describe('Task 12B reverse Results handoff regression', () => {
  it('keeps native list authority until the observed offset reaches a one-point top epsilon', () => {
    expect(screenSource).toContain('.simultaneousWithExternalGesture(nativeResultListGesture)');
    expect(screenSource).toContain('if (observedListOffset.value > 1)');
    expect(screenSource).toContain('collapseProgress.value = 1');
    expect(screenSource).toContain('topReachedTravel.value = -1');
    expect(screenSource).toContain('bounces={false}');
  });

  it('captures one stable top baseline and restores only from post-top translation', () => {
    expect(screenSource).toContain('if (topReachedTravel.value < 0)');
    expect(screenSource).toContain('topReachedTravel.value = downwardTravel');
    expect(screenSource).toContain('eligibleReverseRemainder(');
    expect(screenSource).toContain('reverseCollapseProgress(eligibleRestore, mapCollapseDistance)');
    expect(screenSource).not.toContain('withDecay');
  });

  it('pins SPLIT and prevents the restoring gesture from entering FULL_MAP', () => {
    expect(screenSource).toContain('mapFullyCollapsedRef.current ||');
    expect(screenSource).toContain('resultScrollOffset.current > 0 ||');
    expect(screenSource).toContain('collapseProgress.value > 0');
    expect(screenSource).toContain('runOnJS(commitReversePresentation)(target === 1)');
    expect(screenSource).toContain('fullMapProgress.value = 0');
    expect(screenSource).toContain('Gesture.Race(forwardResultsGesture, reverseResultsGesture)');
    expect(screenSource).toContain('.enabled(!fullMap && !mapFullyCollapsed)');
  });
});

describe('Task 12C FULL_MAP centered result peek regression', () => {
  it('uses the unique loaded LIST collection and LIST pagination authority', () => {
    expect(screenSource).toContain('loadedCount: uniqueVehicleCount(searchItems)');
    expect(screenSource).toContain('hasNextPage: listSearch.hasNextPage === true');
    const summaryStart = screenSource.indexOf('const resultSummary = formatResultSummary');
    const summaryEnd = screenSource.indexOf('    return (', summaryStart);
    const summary = screenSource.slice(summaryStart, summaryEnd);
    expect(summary).not.toContain('mapItems');
    expect(summary).not.toContain('cluster');
  });

  it('renders one full-width centered FULL_MAP summary without the old two-column count', () => {
    expect(screenSource).toContain('accessibilityElementsHidden={!fullMap}');
    expect(screenSource).toContain('style={[styles.fullMapPeekBody, fullMapPeekStyle]}');
    expect(screenSource).toContain('style={styles.fullMapPeekSummaryArea}');
    expect(screenSource).toContain('style={styles.fullMapPeekSummary}');
    expect(screenSource).toMatch(
      /fullMapPeekBody: \{[\s\S]*alignSelf: 'stretch',[\s\S]*overflow: 'hidden',[\s\S]*width: '100%'/,
    );
    expect(screenSource).toMatch(
      /fullMapPeekSummaryArea:[\s\S]*alignItems: 'center'[\s\S]*justifyContent: 'center'[\s\S]*width: '100%'/,
    );
    expect(screenSource).toContain('<View style={{ height: bottomSafeArea }} />');
  });

  it('exposes the broad peek as one accessible Show Results action', () => {
    expect(screenSource).toContain('accessible={fullMap}');
    expect(screenSource).toContain('`${resultSummary}. Show vehicle results.`');
    expect(screenSource).toContain('<Text accessible={false} style={styles.fullMapPeekSummary}>');
    expect(screenSource).toContain('onAccessibilityTap={() => finishFullMapExitGesture(true)}');
  });
});

describe('Task 12D non-sticky normal result summary regression', () => {
  it('owns the SPLIT and FULL_LIST summary as genuine FlatList header content', () => {
    const listStart = screenSource.indexOf('<Reanimated.FlatList');
    const listHeader = screenSource.indexOf('ListHeaderComponent={', listStart);
    const contentContainer = screenSource.indexOf('contentContainerStyle={[', listStart);
    expect(listHeader).toBeGreaterThan(listStart);
    expect(listHeader).toBeLessThan(contentContainer);
    expect(screenSource).toContain('function NormalResultsSummary(');
    expect(screenSource.match(/<NormalResultsSummary/g)).toHaveLength(1);
    expect(screenSource).not.toContain('resultsMetaRow');
  });

  it('does not make the normal summary sticky, fixed, absolute, or independently animated', () => {
    expect(screenSource).not.toContain('stickyHeaderIndices');
    expect(screenSource).toContain('normalResultsSummary: { paddingTop: spacing.xs }');
    expect(screenSource).not.toContain('normalResultsSummary: { position:');
  });

  it('does not duplicate the safe-area inset above the Results summary', () => {
    const listStart = screenSource.indexOf('<Reanimated.FlatList');
    const listEnd = screenSource.indexOf('/>', listStart);
    const list = screenSource.slice(listStart, listEnd);
    expect(list).toContain('contentInsetAdjustmentBehavior="never"');
  });

  it('removes the invisible handle spacing and halves the summary gap in FULL_LIST only', () => {
    expect(screenSource).toContain('mapFullyCollapsed && styles.resultsSheetDragTargetCollapsed');
    expect(screenSource).toContain('compact={mapFullyCollapsed}');
    expect(screenSource).toContain('resultsSheetDragTargetCollapsed: { height: 0, minHeight: 0 }');
    expect(screenSource).toContain('normalResultsSummaryCompact: { paddingTop: spacing.xl }');
    expect(screenSource).toMatch(/resultsSheetCollapsed: \{[\s\S]*paddingTop: 0/);
    expect(screenSource).toContain('resultsSheetDragTarget: {');
    expect(screenSource).toContain('minHeight: 28');
  });

  it('shares one truthful LIST summary authority with FULL_MAP without resetting list state', () => {
    expect(screenSource.match(/formatResultSummary\(\{/g)).toHaveLength(1);
    expect(screenSource).toContain('loadedCount: uniqueVehicleCount(searchItems)');
    expect(screenSource).toContain('hasNextPage: listSearch.hasNextPage === true');
    expect(screenSource).toContain('compact={mapFullyCollapsed}');
    expect(screenSource).toContain('summary={resultSummary}');
    expect(screenSource).toContain('{resultSummary}');
    expect(screenSource).not.toContain('normalResultsCount');
    expect(screenSource).not.toContain('key={resultSummary}');
  });

  it('uses real measured list geometry without guessed header-height corrections', () => {
    expect(screenSource).toContain('listContentHeight.value = height');
    expect(screenSource).toContain('listViewportHeight.value = nativeEvent.layout.height');
    expect(screenSource).toContain('listContentHeight.value - listViewportHeight.value');
    expect(screenSource).not.toContain('summaryHeight.value');
    expect(screenSource).not.toContain('headerHeight.value');
  });

  it('avoids duplicate initial-error and successful-empty wording', () => {
    expect(screenSource).toContain('title="Search unavailable"');
    expect(screenSource).toContain('<ExploreEmptyState');
    expect(screenSource).not.toContain('title="Adjust your search"');
    expect(screenSource.match(/Vehicle results unavailable/g) ?? []).toHaveLength(0);
  });

  it('keeps normal accessibility informational while retaining FULL_MAP action semantics', () => {
    const normalSummaryStart = screenSource.indexOf('function NormalResultsSummary(');
    const normalSummaryEnd = screenSource.indexOf(
      'function SearchResultVehicleCard(',
      normalSummaryStart,
    );
    const normalSummary = screenSource.slice(normalSummaryStart, normalSummaryEnd);
    expect(normalSummary).toContain('accessibilityRole="header"');
    expect(normalSummary).not.toContain('Show vehicle results');
    expect(screenSource).toContain('`${resultSummary}. Show vehicle results.`');
    expect(screenSource).toContain('<Text accessible={false} style={styles.fullMapPeekSummary}>');
  });
});

describe('floating Map restore control regression', () => {
  it('uses presentation progress rather than browsing offset as its authority', () => {
    expect(screenSource).toContain('? nextProgress > 0.65');
    expect(screenSource).toContain(': nextProgress >= 0.8');
    expect(screenSource).toContain('setCollapseMapButtonVisible)(shouldShowMapButton)');
    expect(screenSource).not.toContain('normalizedOffset >= mapButtonShowOffset');
  });

  it('restores through the existing FlatList offset and opens FULL_MAP', () => {
    expect(screenSource).toMatch(
      /function restoreResultsMap\(\) \{[\s\S]*resultListRef\.current\?\.scrollToOffset\(\{ animated: true, offset: 0 \}\)/,
    );
    const restoreStart = screenSource.indexOf('function restoreResultsMap()');
    const restoreEnd = screenSource.indexOf('function syncExploreShortcut', restoreStart);
    const restoreHandler = screenSource.slice(restoreStart, restoreEnd);
    expect(restoreHandler).not.toContain('performSearch');
    expect(restoreHandler).not.toContain('refetch');
    expect(restoreHandler).not.toContain('invalidateQueries');
    expect(restoreHandler).not.toContain('setActivePlace');
    expect(restoreHandler).not.toContain('setActiveRadiusKm');
    expect(restoreHandler).not.toContain('animateToRegion');
    expect(screenSource).not.toContain('showMapMode');
    expect(restoreHandler).toContain('fullMapPresentationOnUi.value = true');
    expect(restoreHandler).toContain('runOnJS(commitMapRestoreToFullMap)()');
    expect(restoreHandler).toContain('fullMapProgress.value = 2');
    expect(restoreHandler).toContain('fullMapProgress.value = withTiming(1, { duration: 260 }');
    expect(screenSource).toMatch(
      /function commitMapRestoreToFullMap\(\) \{[\s\S]*setFullMap\(true\)[\s\S]*setCollapseMapButtonVisible\(false\)/,
    );
  });

  it('animates the floating Map action directly from FULL_LIST to FULL_MAP', () => {
    expect(screenSource).not.toContain('directFullMapRestoreOnUi');
    expect(screenSource).toContain('fullMapHeight * (2 - fullMapProgress.value)');
    expect(screenSource).toContain(
      '(fullMapPeekHeight - resultsCompositionHeight) * (2 - fullMapProgress.value)',
    );
    expect(screenSource).not.toMatch(
      /collapseProgress\.value = withTiming\(0,[\s\S]*fullMapProgress\.value = withTiming\(1/,
    );
  });

  it('provides one safe-area-aware accessible floating action only on useful Results', () => {
    expect(screenSource).toContain('accessibilityLabel="Show map"');
    expect(screenSource).toContain('accessibilityHint="Scrolls results to reveal the map."');
    expect(screenSource).toContain('name="map-outline"');
    expect(screenSource).toContain('const mapRestoreBottom = home');
    expect(screenSource).toContain('54 + Math.max(bottomSafeArea, 10) + spacing.md');
    expect(screenSource).toContain('{ bottom: mapRestoreBottom }');
    expect(screenSource).toContain('Math.max(100, bottomSafeArea + 88)');
    expect(screenSource).toContain('!(listSearch.isError && mapSearch.isError)');
    expect(screenSource).toContain('(searchItems.length > 0 || listSearch.isError)');
  });

  it('keeps the floating Map action above the absolute renter tab bar in FULL_LIST', () => {
    expect(screenSource).toMatch(
      /const mapRestoreBottom = home[\s\S]*54 \+ Math\.max\(bottomSafeArea, 10\) \+ spacing\.md/,
    );
    expect(screenSource).toContain('mapFullyCollapsed && styles.resultsSheetCollapsed');
    expect(screenSource).toContain('setCollapseMapButtonVisible(collapsed)');
  });

  it('keeps the control behind search/filter/detail surfaces and resets with criteria', () => {
    expect(screenSource).toMatch(
      /mapButtonVisible &&\s*!fullMap &&\s*!locationOpen &&\s*!filtersOpen/,
    );
    expect(screenSource).toContain('mapButtonVisibleRef.current = false');
    expect(screenSource).toContain('setMapButtonVisible(false)');
    expect(screenSource).toContain("if (mode === 'results')");
  });

  it('guards repeated restore taps while allowing user interruption', () => {
    expect(screenSource).toContain('if (mapRestoreInProgress.current) return');
    expect(screenSource).toContain('mapRestoreInProgress.current = true');
    expect(screenSource).toContain('onScrollBeginDrag={() => {');
    expect(screenSource).toContain('onMomentumScrollEnd={() => {');
  });
});

describe('three-state Results presentation regression', () => {
  it('keeps split as the canonical anchor and adds one local FULL_MAP progress value', () => {
    expect(screenSource).toContain('const fullMapProgress = useSharedValue(0)');
    expect(screenSource).toContain('const [fullMap, setFullMap] = useState(false)');
    expect(screenSource).toContain('const fullMapGestureThreshold = 72');
    expect(screenSource).toContain('const collapsedMapStyle = useAnimatedStyle(() => ({');
    expect(screenSource).toContain(
      '(fullMapHeight - initialResultsMapHeight) * fullMapProgress.value',
    );
  });

  it('uses cross-platform touch distance and clamps transient negative overscroll', () => {
    expect(screenSource).toContain('const normalizedOffset = Math.max(0, offset)');
    expect(screenSource).toContain('Math.max(0, translationY)');
    expect(screenSource).toContain('fullMapGestureStartY.current - pageY');
    expect(screenSource).toContain('distance / fullMapGestureThreshold');
    expect(screenSource).not.toContain('PanResponder');
  });

  it('commits and cancels FULL_MAP with restrained UI-thread settlement', () => {
    expect(screenSource).toContain('function settleFullMap(target: 0 | 1');
    expect(screenSource).toContain('duration: 180');
    expect(screenSource).toContain('fullMapProgress.value = withTiming(target, { duration: 180 }');
    expect(screenSource).toContain('setFullMap(true)');
    expect(screenSource).toContain('settleFullMap(0, commitFullMapExit)');
  });

  it('derives full height from measured composition and a safe-area-aware peek', () => {
    expect(screenSource).toContain('setResultsCompositionHeight(nativeEvent.layout.height)');
    expect(screenSource).toContain('resultsCompositionHeight - fullMapPeekHeight - spacing.sm');
    expect(screenSource).toContain('Math.max(88, Math.min(104, 64 + bottomSafeArea))');
    expect(screenSource).toContain('flex: fullMapPresentationOnUi.value ? 0 : 1');
    expect(screenSource).not.toContain('styles.resultsSheetFullMap');
  });

  it('keeps one Map and one FlatList while hiding inaccessible card content in FULL_MAP', () => {
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
    expect(screenSource).toContain('accessibilityElementsHidden={fullMap}');
    expect(screenSource).toContain(
      "importantForAccessibility={fullMap ? 'no-hide-descendants' : 'auto'}",
    );
    expect(screenSource).toContain("pointerEvents={fullMap ? 'none' : 'auto'}");
  });

  it('keeps the Task 10 button out of FULL_MAP and preserves Map area presentation', () => {
    expect(screenSource).toMatch(/mapButtonVisible &&\s*!fullMap/);
    expect(screenSource).toContain('resetResultsViewport({ preserveFullMap: fullMap })');
    const settleStart = screenSource.indexOf('function settleFullMap');
    const settleEnd = screenSource.indexOf('function syncExploreShortcut', settleStart);
    const presentationHandlers = screenSource.slice(settleStart, settleEnd);
    expect(presentationHandlers).not.toContain('setActivePlace');
    expect(presentationHandlers).not.toContain('setActiveRadiusKm');
    expect(presentationHandlers).not.toContain('refetch');
    expect(presentationHandlers).not.toContain('animateToRegion');
  });

  it('provides truthful peek states and an accessible tap alternative', () => {
    expect(screenSource).toContain('const resultSummary = formatResultSummary({');
    expect(screenSource).toContain('loadedCount: uniqueVehicleCount(searchItems)');
    expect(screenSource).toContain('hasNextPage: listSearch.hasNextPage === true');
    expect(screenSource).toContain('Show vehicle results.');
    expect(screenSource).toContain('onAccessibilityTap={() => finishFullMapExitGesture(true)}');
  });

  it('settles out of FULL_MAP if both projections fail', () => {
    expect(screenSource).toContain(
      'if (!fullMap || !listSearch.isError || !mapSearch.isError) return',
    );
    expect(screenSource).toContain('const timer = setTimeout(settleFullMapExit, 0)');
    expect(screenSource).toContain('settleFullMap(0, commitFullMapExit)');
  });

  it('collapses every Map layout contribution to zero in settled FULL_LIST', () => {
    expect(screenSource).toContain(
      ': Math.max(0, initialResultsMapHeight * (1 - collapseProgress.value))',
    );
    expect(screenSource).toContain('style={styles.resultsComposition}');
    expect(screenSource).toContain('resultsComposition: { flex: 1 }');
    expect(screenSource).toContain('resultsSheetCollapsed');
  });

  it('normalizes FULL_MAP progress whenever SPLIT or FULL_LIST is settled', () => {
    expect(screenSource).toContain('fullMapPresentationOnUi.value = false');
    expect(screenSource).toMatch(
      /function resetResultsViewport[\s\S]*cancelAnimation\(fullMapProgress\)[\s\S]*fullMapProgress\.value = 0[\s\S]*setFullMap\(false\)/,
    );
    expect(screenSource).toContain('resultScrollOffset.current = 0');
    expect(screenSource).toContain('collapseProgress.value = 0');
  });

  it('expands the Results viewport before progressively revealing normal content', () => {
    expect(screenSource).toContain('const fullMapSheetStyle = useAnimatedStyle(() => ({');
    expect(screenSource).toContain(
      '(fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain('const fullMapContentStyle = useAnimatedStyle(() => {');
    expect(screenSource).toContain('const progress = fullMapVisualProgress(fullMapProgress.value)');
    expect(screenSource).toContain('progress <= 0.6');
    expect(screenSource).toContain('progress >= 0.78');
    expect(screenSource).toContain('style={[styles.flex, fullMapContentStyle]}');
    expect(screenSource).toContain('fullMapSheetStyle,');
  });

  it('preserves one expanding FlatList viewport below the animated Map wrapper', () => {
    const mapWrapper = screenSource.indexOf('accessibilityLabel="Approximate vehicle map region"');
    const sheet = screenSource.indexOf('styles.resultsSheet,', mapWrapper);
    const list = screenSource.indexOf('<Reanimated.FlatList', sheet);
    expect(mapWrapper).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(mapWrapper);
    expect(list).toBeGreaterThan(sheet);
    expect(screenSource).toMatch(
      /<Reanimated\.FlatList[\s\S]*style=\{styles\.flex\}[\s\S]*data=\{searchItems\}/,
    );
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
    expect(screenSource).toContain('splitListViewportHeight');
    expect(screenSource).not.toContain('fullListViewportHeight');
  });

  it('keeps settlement, reset, and Map restore presentation-only across repeated cycles', () => {
    const settleStart = screenSource.indexOf('function settleFullMap');
    const settleEnd = screenSource.indexOf('function syncExploreShortcut', settleStart);
    const handlers = screenSource.slice(settleStart, settleEnd);
    expect(handlers).toContain('settleFullMap(1)');
    expect(handlers).toContain('settleFullMap(0, commitFullMapExit)');
    expect(handlers).not.toContain('apiClient');
    expect(handlers).not.toContain('refetch');
    expect(handlers).not.toContain('setActivePlace');
    expect(handlers).not.toContain('setActiveRadiusKm');
  });
});

describe('Task 12E FULL_MAP to SPLIT reveal regression', () => {
  it('removes the competing flex siblings that caused the cropped-card strip and pop', () => {
    expect(screenSource).toMatch(
      /fullMapPeekBody: \{[\s\S]*alignSelf: 'stretch',[\s\S]*overflow: 'hidden',[\s\S]*width: '100%'/,
    );
    expect(screenSource).not.toContain("fullMapPeekBody: { flex: 1, width: '100%' }");
    expect(screenSource).toContain('fullMapSheetStyle,');
    expect(screenSource).toContain('height: fullMapPeekBodyHeight * progress');
  });

  it('uses one FULL_MAP progress authority for viewport, peek, and list reveal', () => {
    expect(screenSource).toContain('const fullMapSheetStyle = useAnimatedStyle');
    expect(screenSource).toContain('const fullMapContentStyle = useAnimatedStyle');
    expect(screenSource).toContain('const fullMapPeekStyle = useAnimatedStyle');
    expect(screenSource).toContain('style={[styles.fullMapPeekBody, fullMapPeekStyle]}');
    expect(screenSource).not.toContain('cardRevealProgress');
  });

  it('converges swipe, tap, accessibility, and projection-failure exits on one settlement', () => {
    expect(screenSource).toContain('onAccessibilityTap={() => finishFullMapExitGesture(true)}');
    expect(screenSource).toContain('if (fullMap) finishFullMapExitGesture();');
    expect(screenSource).toContain('settleFullMapExit();');
    expect(screenSource).toContain('const timer = setTimeout(settleFullMapExit, 0)');
    expect(screenSource).toContain('settleFullMap(0, commitFullMapExit)');
  });

  it('cancels below threshold back to FULL_MAP without changing accepted thresholds', () => {
    expect(screenSource).toContain('const fullMapGestureThreshold = 72');
    expect(screenSource).toMatch(
      /fullMapGestureDistance\.current >= fullMapGestureThreshold[\s\S]*settleFullMapExit\(\);[\s\S]*else settleFullMap\(1\)/,
    );
    expect(screenSource).toContain(
      "isFocused && ((mode === 'results' && fullMap) || detailPresentationActive)",
    );
  });

  it('normalizes canonical SPLIT state only after the reveal animation finishes', () => {
    const commitStart = screenSource.indexOf('function commitFullMapExit()');
    const commitEnd = screenSource.indexOf('function settleFullMapExit()', commitStart);
    const commit = screenSource.slice(commitStart, commitEnd);
    expect(commit).toContain('observedListOffset.value = 0');
    expect(commit).toContain('resultScrollOffset.current = 0');
    expect(commit).toContain('collapseProgress.value = 0');
    expect(commit).toContain('setCollapseMapButtonVisible(false)');
    expect(commit).toContain('scrollToOffset({ animated: false, offset: 0 })');
    expect(commit).toContain('setFullMap(false)');
  });

  it('preserves one Map, one list, list-header ownership, and fixed card geometry', () => {
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
    expect(screenSource).toContain('ListHeaderComponent={');
    expect(screenSource).toContain('compact={mapFullyCollapsed}');
    expect(screenSource).toContain('aspectRatio: 1.6');
    expect(screenSource).toContain('maxHeight: 240');
    expect(screenSource).not.toContain('cardHeight');
  });

  it('keeps settled accessibility and pointer ownership discrete', () => {
    expect(screenSource).toContain('accessible={fullMap}');
    expect(screenSource).toContain('accessibilityElementsHidden={fullMap}');
    expect(screenSource).toContain("pointerEvents={fullMap ? 'none' : 'auto'}");
    expect(screenSource).toContain('<Text accessible={false} style={styles.fullMapPeekSummary}>');
  });
});

describe('Task 12F-1 settled SPLIT downward entry regression', () => {
  it('gives a new SPLIT downward pan an independent handle lane', () => {
    const entryStart = screenSource.indexOf('const handleFullMapEntryGesture = useMemo(');
    const entryEnd = screenSource.indexOf(
      'const collapsedMapStyle = useAnimatedStyle(',
      entryStart,
    );
    const entry = screenSource.slice(entryStart, entryEnd);
    expect(entry).toContain('.enabled(!fullMap && !mapFullyCollapsed)');
    expect(entry).toContain('.activeOffsetY(2)');
    expect(entry).toContain(
      '.simultaneousWithExternalGesture(forwardResultsGesture, reverseResultsGesture)',
    );
    expect(entry).toContain('runOnJS(beginFullMapGesture)()');
    expect(entry).toContain('Math.max(0, event.translationY) / fullMapExpansionDistance');
    expect(entry).toContain('runOnJS(finishFullMapEntryGesture)(event.translationY)');
    expect(screenSource).toContain('<GestureDetector gesture={handleFullMapEntryGesture}>');
    expect(screenSource).toContain('<GestureDetector gesture={resultsGesture}>');
    expect(screenSource).toContain('styles.resultsSheetDragTarget,');
    expect(screenSource).toContain('mapFullyCollapsed && styles.resultsSheetDragTargetCollapsed');
    expect(screenSource).not.toContain('onTouchStart={({ nativeEvent }) => beginFullMapGesture');
  });

  it('settles below 72 points to SPLIT and at 72 points to FULL_MAP', () => {
    expect(screenSource).toContain('const fullMapGestureThreshold = 72');
    expect(screenSource).toContain('fullMapGestureDistance.current >= fullMapGestureThreshold');
    expect(screenSource).toContain('setFullMap(true)');
    expect(screenSource).toContain('settleFullMap(1)');
    expect(screenSource).toContain('settleFullMap(0, () => {');
    expect(screenSource).toContain('fullMapPresentationOnUi.value = false');
  });

  it('does not allow Task 12B continuation to become FULL_MAP entry', () => {
    const reverseStart = screenSource.indexOf('const reverseResultsGesture = useMemo(');
    const reverseEnd = screenSource.indexOf(
      'const listFullMapEntryGesture = useMemo(',
      reverseStart,
    );
    const reverse = screenSource.slice(reverseStart, reverseEnd);
    expect(reverse).toContain('.enabled(!fullMap && mapFullyCollapsed)');
    expect(reverse).toContain('if (observedListOffset.value > 1)');
    expect(reverse).toContain('runOnJS(commitReversePresentation)(target === 1)');
    expect(reverse).not.toContain('beginFullMapGesture');
    expect(screenSource).toContain('mapFullyCollapsedRef.current ||');
    expect(screenSource).toContain('resultScrollOffset.current > 0 ||');
    expect(screenSource).toContain('collapseProgress.value > 0');
  });

  it('keeps upward handoff, FULL_MAP exit, and Map/card/filter ownership', () => {
    expect(screenSource).toContain('.activeOffsetY(-8)');
    expect(screenSource).toContain('scrollTo(resultListRef, 0, target, false)');
    expect(screenSource).toContain('settleFullMapExit()');
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
    expect(screenSource).toContain('onOpen={() => openVehicle(item.vehicleId)}');
    expect(screenSource).toContain('accessibilityLabel="Search result quick filters"');
  });

  it('accepts a new top-of-list downward pull without requiring the handle', () => {
    const entryStart = screenSource.indexOf('const listFullMapEntryGesture = useMemo(');
    const entryEnd = screenSource.indexOf('const resultsGesture = useMemo(', entryStart);
    const entry = screenSource.slice(entryStart, entryEnd);
    expect(entry).toContain('.enabled(!fullMap && !mapFullyCollapsed)');
    expect(entry).toContain('.activeOffsetY(2)');
    expect(entry).toContain('.simultaneousWithExternalGesture(nativeResultListGesture)');
    expect(entry).toContain('observedListOffset.value <= 1 && collapseProgress.value <= 0.01');
    expect(entry).toContain('if (!allowed) return');
    expect(entry).toContain('runOnJS(beginFullMapGesture)()');
    expect(entry).toContain('runOnJS(finishFullMapEntryGesture)(event.translationY)');
    expect(screenSource).toContain('Gesture.Race(forwardResultsGesture, reverseResultsGesture)');
    expect(screenSource).toContain('listFullMapEntryGesture,');
  });
});

describe('Task 12F physical reverse-gesture settlement regression', () => {
  it('commits FULL_LIST ownership on forward release without waiting for animation completion', () => {
    const forward = screenSource.slice(
      screenSource.indexOf('const forwardResultsGesture = useMemo('),
      screenSource.indexOf('const reverseResultsGesture = useMemo('),
    );
    expect(forward).toContain(
      'runOnJS(commitForwardPresentation)(target === 1, observedListOffset.value)',
    );
    expect(forward).toContain('collapseProgress.value = withTiming(target, { duration: 180 })');
    expect(forward.indexOf('runOnJS(commitForwardPresentation)')).toBeLessThan(
      forward.indexOf('collapseProgress.value = withTiming(target'),
    );
    expect(forward).not.toContain('if (finished)');
  });

  it('commits SPLIT ownership on reverse release and keeps native-list-first reverse guards', () => {
    const reverse = screenSource.slice(
      screenSource.indexOf('const reverseResultsGesture = useMemo('),
      screenSource.indexOf('const listFullMapEntryGesture = useMemo('),
    );
    expect(reverse).toContain('runOnJS(commitReversePresentation)(target === 1)');
    expect(reverse).toContain('collapseProgress.value = withTiming(target, { duration: 180 })');
    expect(reverse.indexOf('runOnJS(commitReversePresentation)')).toBeLessThan(
      reverse.indexOf('collapseProgress.value = withTiming(target'),
    );
    expect(reverse).toContain('if (observedListOffset.value > 1)');
    expect(reverse).toContain('eligibleReverseRemainder(');
    expect(reverse).not.toContain('if (finished)');
  });
});

describe('Task 12F-2 settled FULL_MAP peek regression', () => {
  it('centers one handle and one summary across the full visible peek width', () => {
    expect(
      screenSource.match(/style=\{\[styles\.resultsSheetHandle, collapseHandleStyle\]\}/g),
    ).toHaveLength(1);
    expect(screenSource).toContain('resultsSheetHandle: {');
    expect(screenSource).toContain('resultsSheetDragTarget: {');
    expect(screenSource).toContain("alignItems: 'center'");
    expect(screenSource.match(/style=\{styles\.fullMapPeekSummary\}/g)).toHaveLength(1);
    expect(screenSource).toMatch(
      /fullMapPeekBody: \{[\s\S]*alignItems: 'center',[\s\S]*alignSelf: 'stretch'/,
    );
    expect(screenSource).toMatch(
      /fullMapPeekSummary:[\s\S]*textAlign: 'center',[\s\S]*width: '100%'/,
    );
    expect(screenSource).toMatch(
      /fullMapPeekSummaryArea:[\s\S]*alignSelf: 'stretch',[\s\S]*justifyContent: 'center'/,
    );
  });

  it('centers vertically between handle region and separate bottom safe-area spacer', () => {
    expect(screenSource).toContain('const fullMapHandleRegionHeight =');
    expect(screenSource).toContain('fullMapPeekHeight - fullMapHandleRegionHeight');
    expect(screenSource).toContain('<View style={{ height: bottomSafeArea }} />');
    expect(screenSource).toContain('style={[styles.fullMapPeekBody, fullMapPeekStyle]}');
  });

  it('keeps the FULL_MAP peek compact while retaining its safe-area allowance', () => {
    expect(screenSource).toContain('Math.max(88, Math.min(104, 64 + bottomSafeArea))');
    expect(screenSource).not.toContain('Math.min(124, 96 + bottomSafeArea)');
  });

  it('keeps the mounted normal list in a zero-height clipped viewport at settled FULL_MAP', () => {
    expect(screenSource).toContain('const fullMapListViewportStyle = useAnimatedStyle(() => ({');
    expect(screenSource).toContain(': splitListViewportHeight) *');
    expect(screenSource).toContain(
      'fullMapProgress.value > 1 ? fullMapProgress.value - 1 : 1 - fullMapProgress.value',
    );
    expect(screenSource).toContain("fullMapListViewport: { minHeight: 0, overflow: 'hidden' }");
    expect(screenSource).toContain(
      'style={[styles.fullMapListViewport, fullMapListViewportStyle]}',
    );
    expect(screenSource).toContain("pointerEvents={fullMap ? 'none' : 'auto'}");
    expect(screenSource).toContain('accessibilityElementsHidden={fullMap}');
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
  });

  it('preserves progressive reveal, clean cancel, truthful count, and the 12F-1 entry lane', () => {
    expect(screenSource).toContain(
      '(fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain('progress <= 0.6');
    expect(screenSource).toContain('progress >= 0.78');
    expect(screenSource).toContain('else settleFullMap(1)');
    expect(screenSource).toContain('loadedCount: uniqueVehicleCount(searchItems)');
    expect(screenSource).toContain('const handleFullMapEntryGesture = useMemo(');
    expect(screenSource).not.toContain('`${searchItems.length} loaded`');
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
  });
});

describe('Task 12F-3 outer Results sheet height regression', () => {
  it('uses the same transition authority for growing Map and shrinking outer sheet', () => {
    expect(screenSource).toContain('fullMapPresentationOnUi.value = true');
    expect(screenSource).toContain('fullMapProgress.value = Math.min(');
    expect(screenSource).toContain(
      '(fullMapHeight - initialResultsMapHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain(
      '(fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain('fullMapSheetStyle,');
    expect(screenSource).toContain('flex: fullMapPresentationOnUi.value ? 0 : 1');
    expect(screenSource).not.toContain('styles.resultsSheetFullMap');
  });

  it('keeps settled FULL_MAP compact with dominant Map, visible peek, and zero list viewport', () => {
    expect(screenSource).toContain('resultsCompositionHeight - fullMapPeekHeight - spacing.sm');
    expect(screenSource).toContain(
      '(fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain(': splitListViewportHeight) *');
    expect(screenSource).toContain('accessibilityElementsHidden={!fullMap}');
    expect(screenSource).toContain(
      'style={[styles.fullMapListViewport, fullMapListViewportStyle]}',
    );
    expect(screenSource).toContain("fullMapListViewport: { minHeight: 0, overflow: 'hidden' }");
    expect(screenSource).toContain(
      "isFocused && ((mode === 'results' && fullMap) || detailPresentationActive)",
    );
  });

  it('returns below-threshold entry to SPLIT and reverses height changes on exit', () => {
    expect(screenSource).toContain('settleFullMap(0, () => {');
    expect(screenSource).toContain('settleFullMap(0, commitFullMapExit)');
    expect(screenSource).toContain('fullMapPresentationOnUi.value = false');
    expect(screenSource).toContain('height: fullMapPeekBodyHeight * progress');
    expect(screenSource).toContain(
      '(fullMapHeight - initialResultsMapHeight) * fullMapProgress.value',
    );
    expect(screenSource).toContain(
      '(fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value',
    );
  });

  it('leaves SPLIT flex-filled and FULL_LIST map-zero with full Results viewport', () => {
    expect(screenSource).toContain('resultsSheet: {');
    expect(screenSource).toMatch(/resultsSheet: \{[\s\S]*flex: 1,/);
    expect(screenSource).toContain(
      ': Math.max(0, initialResultsMapHeight * (1 - collapseProgress.value))',
    );
    expect(screenSource).toContain('resultsComposition: { flex: 1 }');
    expect(screenSource).toContain('fullMapPresentationOnUi.value = false');
    expect(screenSource).toContain('styles.flex,');
    expect(screenSource.match(/<DiscoveryMap/g)).toHaveLength(1);
    expect(screenSource.match(/<Reanimated.FlatList/g)).toHaveLength(1);
  });

  it('lets parent layout continuously fill the list viewport as the Map collapses', () => {
    expect(screenSource).toContain('const splitListViewportHeight = Math.max(');
    expect(screenSource).not.toContain('const fullListViewportHeight = Math.max(');
    expect(screenSource).toContain('flex: fullMapPresentationOnUi.value ? 0 : 1');
    expect(screenSource).toMatch(
      /height: fullMapPresentationOnUi\.value[\s\S]*: splitListViewportHeight\) \*[\s\S]*1 - fullMapProgress\.value[\s\S]*: 0/,
    );
    expect(screenSource).not.toContain(
      '(fullListViewportHeight - splitListViewportHeight) * collapseProgress.value',
    );
    expect(screenSource).not.toContain('!mapFullyCollapsed && styles.fullMapListViewport');
    expect(screenSource).toContain('styles.fullMapListViewport,');
  });

  it('lets the outer sheet fill the live space below the collapsing Map', () => {
    const sheetStyle = screenSource.slice(
      screenSource.indexOf('const fullMapSheetStyle = useAnimatedStyle(() => ({'),
      screenSource.indexOf(
        'const fullMapListViewportStyle',
        screenSource.indexOf('const fullMapSheetStyle'),
      ),
    );
    expect(sheetStyle).toContain('flex: fullMapPresentationOnUi.value ? 0 : 1');
    expect(sheetStyle).toMatch(
      /height: fullMapPresentationOnUi\.value[\s\S]*splitResultsHeight \+[\s\S]*fullMapProgress\.value[\s\S]*: 0/,
    );
    expect(sheetStyle).not.toContain('!mapFullyCollapsed');
    expect(screenSource).not.toContain('resultsSheetFullMap:');
  });
});
