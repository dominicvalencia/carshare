import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const primitivesSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/primitives.tsx'),
  'utf8',
);

describe('vehicle-detail responsive regression', () => {
  it('keeps search first, then a compact recovery alert and the Where experience', () => {
    const startSearch = source.indexOf('accessibilityLabel="Start your search"');
    const alert = source.indexOf('style={({ pressed }) => [styles.recoveryAlert');
    const categories = source.indexOf('accessibilityLabel="Vehicle discovery categories"');
    const section = source.indexOf('<ExploreVehicleSection');
    const searchCard = source.indexOf('<Card style={styles.searchCard}>');
    expect(startSearch).toBeGreaterThan(-1);
    expect(alert).toBeGreaterThan(startSearch);
    expect(categories).toBeGreaterThan(alert);
    expect(source).not.toContain('<PendingHandoverRecoveryBanner');
    expect(source).toContain("title={home ? undefined : 'Search cars'}");
    expect(source).toMatch(/action=\{\s*home \? undefined : \(/);
    expect(source).toContain('visible={recoveryActionsOpen && pendingRecoveryActions.length > 0}');
    expect(source).toContain('onPress={() => setRecoveryActionsOpen(true)}');
    expect(source).toMatch(
      /<Button\s+compact\s+label="Not now"\s+onPress=\{closeRecoveryActions\}/,
    );
    expect(source).toContain(
      "navigation.navigate('BookingRecovery', { bookingId: action.reference })",
    );
    expect(categories).toBeGreaterThan(startSearch);
    expect(section).toBeGreaterThan(categories);
    expect(searchCard).toBeGreaterThan(startSearch);
    expect(source).toContain('function openExploreSearch()');
    expect(source).toMatch(/function openExploreSearch\(\) \{\s*setLocationOpen\(true\)/);
    expect(source).not.toContain('function openLegacySearch');
  });

  it('keeps the category row and content-width chips compact without stretch', () => {
    expect(source).toContain('paddingHorizontal: spacing.sm,\n    paddingVertical: spacing.xs,');
    expect(source).toMatch(/<Button\s+compact\s+label="Not now"/);
    expect(source).toMatch(/exploreCategoryContent:\s*\{\s*alignItems: 'center'/);
    expect(source).toContain('exploreCategoryRow: { flexGrow: 0, height: 48');
    expect(primitivesSource).toMatch(
      /chipCompact:\s*\{\s*alignSelf: 'center',\s*flexGrow: 0,\s*flexShrink: 0,\s*minHeight: 44/,
    );
    expect(primitivesSource).toContain('selected && styles.chipSelected');
    expect(primitivesSource).toContain('chipSelected: { backgroundColor: colors.primary');
    expect(primitivesSource).toContain('chipTextSelected: { color: colors.onPrimary }');
    const categories = source.slice(
      source.indexOf('accessibilityLabel="Vehicle discovery categories"'),
      source.indexOf(
        '</ScrollView>',
        source.indexOf('accessibilityLabel="Vehicle discovery categories"'),
      ),
    );
    expect(categories.match(/<Chip\s+compact/g)).toHaveLength(5);
    expect(categories).toContain('horizontal');
    expect(categories).toContain("selected={exploreShortcut === 'ALL'}");
    expect(categories).toContain('onPress={() => selectExploreShortcut');
  });

  it('uses the existing stale-safe Places provider for the Where step', () => {
    expect(source).toContain('title="Search cars"');
    expect(source).toContain('Where?');
    expect(source).toContain('Search destinations, cities or places');
    expect(source).toMatch(
      /bookingLocationProvider\s*\.searchPlaces\(query\.trim\(\), session\.current\)/,
    );
    expect(source).toMatch(
      /bookingLocationProvider\.resolvePlace\(\s*providerReference,\s*session\.current,?\s*\)/,
    );
    expect(source).toContain('const timer = setTimeout(() =>');
    expect(source).toContain('}, 350)');
    expect(source).toContain('const id = ++request.current');
    expect(source).toContain('if (id === request.current) setSuggestions(items)');
    expect(source).toMatch(/if \(value\.trim\(\)\.length < 3\) \{\s*request\.current \+= 1/);
    expect(source).toContain('session.current = searchLocationSession()');
    expect(source).toContain('label="Clear location search"');
  });

  it('keeps Nearby permission user-initiated and advances only after success', () => {
    expect(source).toContain('accessibilityLabel="Nearby, find cars around your current area"');
    expect(source).toContain('onPress={() => void selectNearby()}');
    expect(source).toContain('const selectedCurrentArea = await onCurrent()');
    expect(source).toContain('if (selectedCurrentArea)');
    expect(source).toContain("label: 'Current area'");
    expect(source).toContain('Location.requestForegroundPermissionsAsync()');
  });

  it('collapses a valid Where selection into the Task 5 placeholder', () => {
    expect(source).toContain('setWhereExpanded(false)');
    expect(source).toContain('Edit discovery location');
    expect(source).toContain('When');
    expect(source).toContain('Add trip dates');
    expect(source).not.toContain('label="Continue with exact times"');
    expect(source).toMatch(/It stays selected until a replacement is\s*confirmed\./);
  });

  it('uses the shared exact Date authority for the When range calendar', () => {
    expect(source).toContain('<TripDateCalendar');
    expect(source).toContain('appliedStart={pickup}');
    expect(source).toContain('appliedEnd={returnAt}');
    expect(source).toContain('setDraftStart(start)');
    expect(source).toContain('setDraftEnd(end)');
    expect(source).toContain('setPickup(nextStart)');
    expect(source).toContain('setReturnAt(nextEnd)');
    expect(source).toContain('datesExplicit: draftDatesEstablished');
    expect(source).toContain('setTripDatesEstablished(datesExplicit)');
    expect(source).toContain('tripDateSummary(pickup, returnAt)');
    expect(source).toContain('label="Search"');
    expect(source).toContain('Select and apply trip dates to search.');
    expect(source).toContain('start: pickup.toISOString()');
    expect(source).toContain('end: returnAt.toISOString()');
  });

  it('keeps Search limited to location and the trip date range', () => {
    const searchSheet = source.slice(
      source.indexOf('function LocationSheet'),
      source.indexOf('type FilterProperties'),
    );
    expect(searchSheet).toContain('<TripDateCalendar');
    expect(searchSheet).toContain('Select your trip dates');
    expect(searchSheet).not.toContain('<DateTimeField');
    expect(searchSheet).not.toContain('Pickup preference');
    expect(searchSheet).not.toContain('Return preference');
    expect(searchSheet).not.toContain('<LocationPicker');
  });

  it('keeps sheet edits draft-only until the existing search authority applies them', () => {
    expect(source).toContain('type SearchDraft =');
    expect(source).toContain('const [draftSelected, setDraftSelected] = useState(selected)');
    expect(source).toContain('const [draftStart, setDraftStart] = useState(appliedStart)');
    expect(source).toContain('const [draftEnd, setDraftEnd] = useState(appliedEnd)');
    expect(source).toContain('function performSearch(draft?: SearchDraft)');
    expect(source).toContain('const nextPlace = draft?.place ?? place');
    expect(source).toContain('setActivePlace(nextPlace)');
    expect(source).toContain('resultScrollOffset.current = 0');
    expect(source).toContain('Keyboard.dismiss()');
    expect(source).toContain("setMode('results')");
  });

  it('edits active criteria from Results without routing through the old form', () => {
    expect(source).toContain('accessibilityLabel="Back to Explore"');
    expect(source).toContain('accessibilityHint="Edit search"');
    expect(source).toContain(
      'accessibilityLabel={`${activePlace.label}, ${tripDateSummary(pickup, returnAt)}`}',
    );
    expect(source).toContain('onPress={() => setLocationOpen(true)}');
    expect(source).toContain('{searchEditor}');
    expect(source).toContain('selected={discoveryLocationEstablished ? activePlace : place}');
    expect(source).toContain('tripDateSummary(pickup, returnAt)');
  });

  it('keeps compact fixed Results controls with a truthful list-owned summary', () => {
    expect(source).toContain('style={styles.resultsHeader}');
    expect(source).toContain('const resultsFilterCount = activeFilterCount({');
    expect(source).toContain('`Filters, ${resultsFilterCount} active`');
    expect(source).toContain("'Filters, none active'");
    expect(source).toContain('const resultSummary = formatResultSummary({');
    expect(source).toContain('loadedCount: uniqueVehicleCount(searchItems)');
    expect(source).toContain(
      'ListHeaderComponent={<NormalResultsSummary summary={resultSummary} />}',
    );
  });

  it('maps quick filters to the existing authoritative filter fields', () => {
    expect(source).toContain('accessibilityLabel="Search result quick filters"');
    expect(source).toContain(
      "handover === 'DELIVERY_AVAILABLE' || handover === 'PICKUP_AND_DELIVERY'",
    );
    expect(source).toContain("setHandover(deliveryFilterActive ? 'ANY' : 'DELIVERY_AVAILABLE')");
    expect(source).toContain("const nextCategory = categoryId === id ? '' : id");
    expect(source).toContain('setCategoryId(nextCategory)');
    expect(source).toContain(
      "const nextPowertrain = powertrain === 'BATTERY_ELECTRIC' ? '' : 'BATTERY_ELECTRIC'",
    );
    expect(source).toContain('setPowertrain(nextPowertrain)');
    expect(source).toContain("const nextSeats = seats === '7' ? '' : '7'");
    expect(source).toContain('setSeats(nextSeats)');
    expect(source).toContain('selected={Boolean(minPrice || maxPrice)}');

    const quickFilterStart = source.indexOf('accessibilityLabel="Search result quick filters"');
    const quickFilterEnd = source.indexOf('</ScrollView>', quickFilterStart);
    const quickFilters = source.slice(quickFilterStart, quickFilterEnd);
    expect(quickFilters).not.toContain('label="All"');
    expect(quickFilters).not.toContain('label="Nearby"');
    expect(quickFilters).not.toContain('Highly rated');
  });

  it('starts a fresh result page after a quick-filter change', () => {
    expect(source).toMatch(/function prepareResultsFilterChange\(\) \{\s*resetResultsViewport\(\)/);
    expect(source).toMatch(
      /function resetResultsViewport\(\{ preserveFullMap = false \} = \{\}\) \{\s*resultScrollOffset\.current = 0;\s*observedListOffset\.value = 0;\s*collapseProgress\.value = 0/,
    );
    expect(source).toMatch(
      /function toggleResultsDelivery\(\) \{\s*prepareResultsFilterChange\(\)/,
    );
    expect(source).toContain("queryKey: ['public-search', 'LIST', listQueryString]");
    expect(source).toContain("queryKey: ['public-search', 'MAP', mapQueryString]");
  });

  it('maps one active category shortcut onto existing search authority', () => {
    expect(source).toContain('type ExploreShortcut =');
    expect(source).toContain('label="All"');
    expect(source).toContain('label="Nearby"');
    expect(source).toContain("['SUV', 'SEDAN'].flatMap");
    expect(source).toContain("setPowertrain('BATTERY_ELECTRIC')");
    expect(source).toContain("setSeats('7')");
    expect(source).toContain("if (shortcut.startsWith('CATEGORY:'))");
    expect(source).toContain("if (shortcut === 'NEARBY') void selectCurrentLocation(true)");
    expect(source).toContain('async function selectCurrentLocation(activateSearch = false)');
    expect(source).toContain('const activeCriteriaQueryString = useMemo(() =>');
  });

  it('renders responsive, privacy-safe single-image Explore rails', () => {
    expect(source).toContain('function ExploreVehicleSection');
    expect(source).toContain('function ExploreVehicleCard');
    expect(source).toContain('Math.min(320, Math.max(250, viewportWidth - 72))');
    expect(source).toContain('contentPath={vehicle.coverPhoto?.contentPath}');
    expect(source).toContain('vehicle.approximateLocation.city');
    expect(source).toContain('vehicle.approximateLocation.province');
    expect(source).toContain('vehicle.displayPrice.amountMinor');
    expect(source).not.toContain('vehicle.location.latitude');
    expect(source).toContain('if (items.length === 0) return null;');
    expect(source).toContain('title="Electric cars"');
    expect(source).toContain('title="Available for your trip"');
  });

  it('uses one compact semibold heading style for every Explore vehicle rail', () => {
    expect(source).toContain(
      "exploreSectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' }",
    );
    expect(source).toContain('style={styles.exploreSectionTitle}');
  });

  it('keeps rail queries independent, hearts shared, and trip See all faithful to Results', () => {
    expect(source).toContain("exploreRailQuery(activePlace, activeRadiusKm, 'AREA', {");
    expect(source).toContain("exploreRailQuery(activePlace, activeRadiusKm, 'ELECTRIC')");
    expect(source).toContain("queryKey: ['public-search', 'rail', areaRailQueryString]");
    expect(source).toContain("queryKey: ['public-search', 'rail', electricRailQueryString]");
    expect(source).toContain(
      'const tripRailEligible = showTripRail(tripDatesEstablished, pickup, returnAt)',
    );
    expect(source).toContain('railFavoriteOverrides[vehicle.vehicleId] ?? vehicle.favorite');
    expect(source).toContain('setRailFavoriteOverrides((current) =>');
    expect(source).toContain('onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}');
    expect(source).toMatch(
      /onSeeAll=\{\(\) => \{\s*resetResultsViewport\(\);\s*setMode\('results'\)/,
    );
    expect(source).toContain('{onSeeAll ? (');
  });

  it('places optional account history rails before contextual rails without changing active search', () => {
    expect(source).toContain("queryKey: ['renter-history', 'searches', user?.id]");
    expect(source).toContain("queryKey: ['renter-history', 'vehicles', user?.id]");
    expect(source).toContain("enabled: home && mode === 'form' && authenticatedRenter");
    expect(source).toContain("queryKey: ['public-search', 'rail', 'continue', continuedRailQuery]");
    expect(source).toContain('latestReconstructibleSearch(recentSearchHistory.data?.items ?? [])');
    expect(source).toContain('recentVehicleHistory.data?.items ?? []');
    expect(source).toContain('continuedRailSearch.data?.items ?? []');
    expect(source).toContain('recentSearchHistory.isError');
    expect(source).toContain('recentVehicleHistory.isError ? []');
    expect(source).toContain('continuedRailSearch.isError ? []');
    expect(source).toContain('onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}');
    expect(source).toContain(
      'favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })',
    );
    expect(source).toContain('title="Recently viewed"');
    expect(source).toContain("title={continuedSearch?.title ?? 'Continue exploring'}");
    expect(source.indexOf('title="Recently viewed"')).toBeLessThan(
      source.indexOf("title={continuedSearch?.title ?? 'Continue exploring'}"),
    );
    expect(source.indexOf("title={continuedSearch?.title ?? 'Continue exploring'}")).toBeLessThan(
      source.indexOf('title="Electric cars"'),
    );
    expect(source).toMatch(
      /onSeeAll=\{\s*continuedSearch\?\.start && continuedSearch\.end \? openContinuedResults : undefined\s*\}/,
    );
    expect(source).toContain('if (!continuedSearch?.start || !continuedSearch.end) return;');
    expect(source).toContain('setActivePlace(continuedSearch.location)');
    expect(source).toContain('setTripDatesEstablished(true)');
    expect(source).toContain(
      "void client.invalidateQueries({ queryKey: ['renter-history', 'vehicles'] })",
    );
    expect(source).toContain('const areaRailQueryString = exploreRailQuery(activePlace');
    expect(source).toContain('if (items.length === 0) return null;');
  });

  it('isolates the authenticated saved-similarity rail between history and contextual rails', () => {
    expect(source).toContain("'renter-recommendations',");
    expect(source).toContain("'saved-similar',");
    expect(source).toContain('/me/discovery-recommendations/saved-similar?');
    expect(source).toContain('savedSimilarity.isError ? []');
    expect(source).toContain(
      'items={savedSimilarityRailItems.length >= 2 ? savedSimilarityRailItems : []}',
    );
    expect(source).toContain('title="More like cars you\'ve saved"');
    expect(source.indexOf('title="More like cars you\'ve saved"')).toBeGreaterThan(
      source.indexOf("title={continuedSearch?.title ?? 'Continue exploring'}"),
    );
    expect(source.indexOf('title="More like cars you\'ve saved"')).toBeLessThan(
      source.indexOf('title="Electric cars"'),
    );
    expect(source).toContain('if (!discoveryLocationEstablished) return');
    expect(source).toContain('if (tripDatesEstablished)');
    expect(source).toContain(
      "void client.invalidateQueries({ queryKey: ['renter-recommendations', 'saved-similar'] })",
    );
  });

  it('records only committed renter searches, not place autocomplete or guest browsing', () => {
    const commit = source.slice(
      source.indexOf('function performSearch('),
      source.indexOf('function searchMapArea('),
    );
    const autocomplete = source.slice(source.indexOf('function LocationSheet('));
    expect(commit).toContain("user?.roles.includes('RENTER')");
    expect(commit).toContain(".request('/me/discovery-history/searches'");
    expect(commit).toContain('datesExplicit');
    expect(autocomplete).not.toContain(".request('/me/discovery-history/searches'");
  });

  it('presents existing persistent favorites as the Wishlist', () => {
    expect(source).toContain('title="Wishlist"');
    expect(source).toContain('title="No saved cars yet"');
    expect(source).toContain('message="Tap the heart on a vehicle to save it here."');
    expect(source).toContain('apiClient.request(`/favorites/${id}`');
    expect(source).toContain('title="Wishlist unavailable"');
    expect(source).toContain('onRetry={() => void favorites.refetch()}');
  });

  it('refreshes dated results so newly occupied vehicles are removed', () => {
    expect(source).toContain(
      "refetchInterval: mode === 'results' || (home && tripRailEligible) ? 5_000 : false",
    );
    expect(source).toContain("refetchOnMount: 'always'");
    expect(source).toContain('void listSearch.refetch()');
    expect(source).toContain('void mapSearch.refetch()');
  });

  it('sizes the hero gallery from the viewport instead of a device-specific width', () => {
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('{ height: viewportHeight, width: viewportWidth }');
    expect(source).not.toMatch(/heroImage:\s*\{[^}]*width:\s*390/);
  });

  it('scrolls once only after successful quote data renders', () => {
    expect(source).toContain("properties.mode === 'quote' && quoteData");
    expect(source).toContain('lastScrolledQuoteId.current === quoteData.id');
    expect(source).toContain('scrollRef.current?.scrollTo');
  });

  it('uses server cursors for incremental loading and preserves the result offset', () => {
    expect(source).toContain('useInfiniteQuery');
    expect(source).toContain('getNextPageParam');
    expect(source).toContain('onEndReachedThreshold={0.25}');
    expect(source).toContain('listSearch.fetchNextPage()');
    expect(source).toContain('resultScrollOffset.current');
  });

  it('renders only projected positive long-trip discounts before price check', () => {
    expect(source).toContain('positiveDurationDiscounts(vehicle.pricing.durationDiscounts)');
    expect(source).toContain('durationDiscounts.length > 0');
    expect(source).toContain('Save more on longer trips');
    expect(source).toContain('Discount is applied automatically when your rental dates qualify.');
    expect(source.indexOf('Save more on longer trips')).toBeLessThan(
      source.indexOf('title="Your trip"'),
    );
    expect(source).not.toContain('policyVersionId');
  });
});

describe('fulfillment discovery presentation', () => {
  it('keeps server-owned handover filtering and contextual badges', () => {
    expect(source).toContain("query.set('handover', handover)");
    expect(source).toContain('Pickup & delivery available');
    expect(source).toContain('Delivery to your location');
    expect(source).not.toContain('Self-drive');
    expect(source).toContain(
      "vehicle.fulfillment.deliveryToSearchLocationReason === 'INSUFFICIENT_NOTICE'",
    );
    expect(source).toContain('Delivery requires');
    expect(source).not.toContain(
      "vehicle.fulfillment.deliveryToSearchLocationReason === 'OUTSIDE_SERVICE_RADIUS'",
    );
  });

  it('presents safe handover policy detail without booking selection or point fabrication', () => {
    expect(source).toContain('title="Handover options"');
    expect(source).toContain(
      'Actual booking total and handover eligibility are confirmed during booking.',
    );
    expect(source).toContain('approximately ${Math.round');
    expect(source).toContain('Delivery & collection notice');
    expect(source).toContain('This notice period only applies to owner delivery or collection.');
    expect(source).toContain("'No minimum notice.'");
    expect(source).not.toContain('Owner Payable Liability');
  });
});

describe('vertical Search Result vehicle card', () => {
  const cardStart = source.indexOf('function SearchResultVehicleCard(');
  const cardEnd = source.indexOf('function ExploreVehicleSection(', cardStart);
  const card = source.slice(cardStart, cardEnd);

  it('keeps a focused component boundary without owning search or map state', () => {
    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(source).toContain('<SearchResultVehicleCard');
    expect(card).toContain('readonly vehicle: VehicleCardView');
    expect(card).toContain('readonly onOpen: () => void');
    expect(card).toContain('readonly onFavorite: () => void');
    expect(card).not.toContain('useState(');
    expect(card).not.toContain('performSearch');
    expect(card).not.toContain('mapSearch');
    expect(card).not.toContain('listSearch');
  });

  it('uses one projected cover image with a stable responsive frame', () => {
    expect(card).toContain('contentPath={vehicle.coverPhoto?.contentPath}');
    expect(card).toContain('style={styles.vehicleImageFrame}');
    expect(card).toContain('style={styles.cardImage}');
    expect(card).toContain('accessible={false}');
    expect(card).not.toContain('vehicle.photos');
    expect(card).not.toContain('gallery');
    expect(card).not.toContain('useQuery');
    expect(source).toMatch(/vehicleImageFrame:\s*\{[\s\S]*?aspectRatio:\s*1\.6/);
  });

  it('uses only authoritative projected price, rating, location, and distance', () => {
    expect(card).toContain('vehicle.displayPrice.amountMinor');
    expect(card).toContain('vehicle.currency');
    expect(card).toContain('<Text style={styles.vehiclePriceUnit}>/ day</Text>');
    expect(card).toContain('vehicle.rating?.averageRating');
    expect(card).toContain('vehicle.rating.reviewCount > 0');
    expect(card).toContain("'New, no reviews yet'");
    expect(card).toContain('vehicle.approximateLocation.city');
    expect(card).toContain('vehicle.approximateLocation.province');
    expect(card).toContain('vehicle.distanceKm.toFixed(1)');
    expect(card).not.toContain('estimatedRentalTotal');
    expect(card).not.toContain('latitude');
    expect(card).not.toContain('longitude');
    expect(card).not.toContain('address');
  });

  it('limits normal metadata to three useful attributes and one fulfillment label', () => {
    expect(card).toContain('`${vehicle.seats} seats`');
    expect(card).toContain('domainLabel(vehicle.transmission)');
    expect(card).toContain('vehicle.category?.name');
    expect(card).not.toContain('vehicle.powertrain');
    expect(card).toContain("attributes.slice(0, 3).join(' · ')");
    expect(card).toContain('const fulfillmentLabel =');
    expect(card).toContain("'Delivery to your location'");
    expect(card).toContain("'Delivery available'");
    expect(card).toContain("'Pickup available'");
    expect(card.match(/<StatusBadge/g)).toHaveLength(1);
  });

  it('retains the search-specific insufficient-notice warning', () => {
    expect(card).toContain(
      "vehicle.fulfillment.deliveryToSearchLocationReason === 'INSUFFICIENT_NOTICE'",
    );
    expect(card).toContain('vehicle.fulfillment.fulfillmentMinimumNoticeMinutes');
    expect(card).toContain('Delivery requires');
    expect(card).toContain('noticeLabel(');
  });

  it('keeps card navigation and Wishlist as separate actions', () => {
    const openPressable = card.indexOf('<Pressable');
    const openPressableEnd = card.indexOf('</Pressable>', openPressable);
    const heart = card.indexOf('<IconButton', openPressableEnd);
    expect(openPressable).toBeGreaterThan(-1);
    expect(openPressableEnd).toBeGreaterThan(openPressable);
    expect(heart).toBeGreaterThan(openPressableEnd);
    expect(card.slice(openPressable, openPressableEnd)).toContain('onPress={onOpen}');
    expect(card.slice(heart)).toContain('onPress={onFavorite}');
    expect(card).toContain("vehicle.favorite ? 'Remove' : 'Save'");
    expect(card).toContain("vehicle.favorite ? 'from' : 'to'");
  });

  it('keeps long content controlled without hiding the full price', () => {
    expect(card).toContain('<Text numberOfLines={2} style={styles.vehicleTitle}>');
    expect(card).toContain('<Text numberOfLines={1} style={styles.vehicleLocation}>');
    expect(card).toContain('<Text numberOfLines={2} style={styles.vehicleAttributes}>');
    expect(card).toContain('<Text numberOfLines={1} style={styles.vehiclePrice}>');
    expect(source).toMatch(/vehiclePrice:\s*\{[^}]*flexShrink:\s*0/);
    expect(source).toMatch(/vehicleLocation:\s*\{[^}]*flex:\s*1/);
  });

  it('preserves stable FlatList identity and the existing result interaction architecture', () => {
    expect(source).toContain('keyExtractor={(item) => item.vehicleId}');
    expect(source).toContain('<Reanimated.FlatList');
    expect(source).toContain('onEndReachedThreshold={0.25}');
    expect(source).toContain('listSearch.fetchNextPage()');
    expect(source).toContain('paddingBottom: Math.max(100, bottomSafeArea + 88)');
    expect(source).toContain('<DiscoveryMap');
    expect(source).not.toContain('presentationMode');
  });
});
