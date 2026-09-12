import { useMemo, useRef, useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ApiError, apiClient } from '../../auth/api-client';
import {
  developmentLocationSuggestions,
  type LocationSuggestion,
} from '../../location/location-provider';
import type { RenterTabParamList, RootStackParamList } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import { VehicleImage } from '../../ui/VehicleImage';
import {
  SearchableReferenceSelector,
  type ReferenceOption,
} from '../../ui/SearchableReferenceSelector';
import { dateTimeLabel, domainLabel, money, timeLabel } from '../../ui/format';
import {
  BackControl,
  Button,
  Card,
  Chip,
  Field,
  Icon,
  IconButton,
  Screen,
  SectionHeader,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import type { BookingView } from '../bookings/MyBookingsScreen';
import { invalidateRenterVerification } from '../../query/verification-invalidation';
import { LocationPicker } from '../../location/LocationPicker';
import {
  locationLabel as confirmedLocationLabel,
  type CarShareLocation,
} from '../../location/booking-location-provider';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import {
  chargeableDays,
  durationDiscountMessage,
  percentageLabel,
  positiveDurationDiscounts,
  type PublicDurationDiscount,
} from './duration-discount-presentation';

interface Grant {
  readonly contentPath: string;
  readonly expiresAt: string;
}
interface Rating {
  readonly averageRating: string | null;
  readonly label?: string;
  readonly reviewCount: number;
}
interface PublicFulfillment {
  readonly renterPickupAvailable: boolean;
  readonly ownerDeliveryAvailable: boolean;
  readonly renterReturnAvailable?: boolean;
  readonly ownerCollectionAvailable?: boolean;
  readonly deliveryToSearchLocation: boolean | null;
  readonly deliveryToSearchLocationReason?: string | null;
  readonly deliveryDistanceMeters: number | null;
  readonly deliveryFeeMinor?: number | null;
  readonly collectionFeeMinor?: number | null;
  readonly fulfillmentServiceRadiusMeters?: number | null;
  readonly fulfillmentMinimumNoticeMinutes?: number;
}
export interface VehicleCardView {
  readonly vehicleId: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly distanceKm: number;
  readonly favorite: boolean;
  readonly category?: { readonly id: string; readonly code: string; readonly name: string } | null;
  readonly coverPhoto?: Grant;
  readonly approximateLocation: { city: string; province: string };
  readonly displayPrice: { amountMinor: number; label: string };
  readonly currency: string;
  readonly transmission?: string | null;
  readonly seats?: number | null;
  readonly fuelType?: string | null;
  readonly rating?: Rating;
  readonly availability: { available: boolean; warning: string };
  readonly estimatedRentalTotal?: { amountMinor: number; chargeableDays: number };
  readonly fulfillment: PublicFulfillment;
}
interface SearchResponse {
  readonly items: readonly VehicleCardView[];
  readonly pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}
interface VehicleDetail {
  readonly vehicleId: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly variant: string | null;
  readonly year: number | null;
  readonly description: string | null;
  readonly favorite: boolean;
  readonly seats: number | null;
  readonly doors?: number | null;
  readonly transmission: string | null;
  readonly fuelType?: string | null;
  readonly powertrain?: string | null;
  readonly category?: { name: string } | null;
  readonly location: { city: string; province: string };
  readonly pricing: {
    currency: string;
    dailyRateMinor: number;
    durationDiscounts?: readonly PublicDurationDiscount[];
  };
  readonly mileagePolicy: {
    type: string;
    includedKilometersPerChargeableDay?: number;
    excessKilometerRateMinor?: number;
  };
  readonly features: readonly { id: string; name: string }[];
  readonly photos?: readonly (Grant & { id: string })[];
  readonly rating?: Rating;
  readonly owner: {
    displayName: string;
    verified: boolean;
    publicReference: string;
    rating?: Rating;
    memberSince?: string;
  };
  readonly returnPolicy?: {
    fuel?: string | null;
    ev?: string | null;
    evRequiredPercentage?: number | null;
  };
  readonly turnaroundMinutes?: number;
  readonly rentalRequirements?: string | null;
  readonly fulfillment: PublicFulfillment;
}
interface Quote {
  readonly id: string;
  readonly vehicleId: string;
  readonly chargeableDays: number;
  readonly currency: string;
  readonly totalMinor: number;
  readonly baseRentalAmountMinor: number;
  readonly durationDiscountAmountMinor: number;
  readonly discountedRentalSubtotalMinor: number;
  readonly includedMileageKm: number | null;
  readonly expiresAt: string;
  readonly lines: readonly { code: string; description: string; amountMinor: number }[];
  readonly fulfillment: {
    readonly startMethod: 'RENTER_PICKUP' | 'OWNER_DELIVERY';
    readonly endMethod: 'RENTER_RETURN' | 'OWNER_COLLECTION';
    readonly startLocation: FulfillmentDestination;
    readonly endLocation: FulfillmentDestination;
    readonly deliveryFeeMinor: number;
    readonly collectionFeeMinor: number;
    readonly deliveryDistanceMeters: number | null;
    readonly collectionDistanceMeters: number | null;
  };
}
interface FulfillmentDestination {
  readonly addressLine1?: string;
  readonly barangay?: string;
  readonly city: string;
  readonly province: string;
  readonly postalCode?: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
}
interface QuoteFulfillmentInput {
  readonly startMethod: 'RENTER_PICKUP' | 'OWNER_DELIVERY';
  readonly endMethod: 'RENTER_RETURN' | 'OWNER_COLLECTION';
  readonly deliveryDestination?: FulfillmentDestination;
  readonly collectionDestination?: FulfillmentDestination;
  readonly collectionSameAsDelivery: boolean;
}
interface PaymentSetupResult {
  readonly booking: BookingView;
  readonly customerActionUrl: string | null;
}
type SearchLocation = LocationSuggestion;
type ViewMode = 'form' | 'results' | 'detail' | 'favorites' | 'quote';

const locations = developmentLocationSuggestions;
const sessionRecentlyViewed: string[] = [];

function futureDate(days: number, hour = 9) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
}

export function DiscoveryScreen({
  home = false,
  initialMode = 'form',
  initialVehicleId,
  onExit,
}: {
  readonly home?: boolean;
  readonly initialMode?: 'form' | 'favorites';
  readonly initialVehicleId?: string | undefined;
  readonly onExit?: (() => void) | undefined;
}) {
  const navigation = useNavigation<NavigationProp<RenterTabParamList>>();
  const client = useQueryClient();
  const [mode, setMode] = useState<ViewMode>(initialVehicleId ? 'detail' : initialMode);
  const detailOrigin = useRef<ViewMode>(initialMode === 'favorites' ? 'favorites' : 'results');
  const [vehicleId, setVehicleId] = useState<string | null>(initialVehicleId ?? null);
  const [place, setPlace] = useState<SearchLocation>(locations[0]!);
  const [pickup, setPickup] = useState(futureDate(1));
  const [returnAt, setReturnAt] = useState(futureDate(2));
  const [radiusKm, setRadiusKm] = useState(25);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [make, setMake] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [seats, setSeats] = useState('');
  const [transmission, setTransmission] = useState('');
  const [powertrain, setPowertrain] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [handover, setHandover] = useState('ANY');
  const [locationError, setLocationError] = useState('');
  const validDates = returnAt.getTime() > pickup.getTime();
  const queryString = useMemo(() => {
    const query = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      radius: String(radiusKm),
      sort: 'RECOMMENDED',
      start: pickup.toISOString(),
      end: returnAt.toISOString(),
      limit: '10',
    });
    if (make.trim()) query.set('make', make.trim());
    if (categoryId) query.set('categoryId', categoryId);
    if (seats) query.set('seats', seats);
    if (transmission) query.set('transmission', transmission);
    if (powertrain) query.set('powertrain', powertrain);
    if (minPrice) query.set('minPrice', String(Math.round(Number(minPrice) * 100)));
    if (maxPrice) query.set('maxPrice', String(Math.round(Number(maxPrice) * 100)));
    if (handover !== 'ANY') query.set('handover', handover);
    return query.toString();
  }, [
    make,
    categoryId,
    maxPrice,
    minPrice,
    pickup,
    place,
    powertrain,
    radiusKm,
    returnAt,
    seats,
    transmission,
    handover,
  ]);
  const search = useInfiniteQuery({
    enabled: mode === 'results' || home,
    queryKey: ['public-search', queryString],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.request<SearchResponse>(
        `/vehicles/search?${queryString}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor ?? undefined,
  });
  const searchItems = useMemo(
    () => search.data?.pages.flatMap((page) => page.items) ?? [],
    [search.data?.pages],
  );
  const nextPageError = search.isFetchNextPageError ? search.error : null;
  const fetchNextSearchPage = search.fetchNextPage;
  const resultListRef = useRef<FlatList<VehicleCardView>>(null);
  const resultScrollOffset = useRef(0);
  const detail = useQuery({
    enabled: Boolean(vehicleId) && (mode === 'detail' || mode === 'quote'),
    queryKey: ['public-vehicle', vehicleId],
    queryFn: () => apiClient.request<VehicleDetail>(`/vehicles/${vehicleId}`),
  });
  const favorites = useQuery({
    enabled: mode === 'favorites',
    queryKey: ['favorites'],
    queryFn: () =>
      apiClient.request<{ items: readonly { vehicle: VehicleDetail }[]; unavailableCount: number }>(
        '/favorites',
      ),
  });
  const favorite = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.request(`/favorites/${id}`, { method: active ? 'DELETE' : 'PUT' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['favorites'] });
      void client.invalidateQueries({ queryKey: ['public-search'] });
      void client.invalidateQueries({ queryKey: ['public-vehicle'] });
    },
  });
  const quote = useMutation({
    mutationFn: (fulfillment: QuoteFulfillmentInput) =>
      apiClient.request<Quote>(`/vehicles/${vehicleId}/quotes`, {
        body: JSON.stringify({
          start: pickup.toISOString(),
          end: returnAt.toISOString(),
          ...fulfillment,
        }),
        method: 'POST',
      }),
    onSuccess: () => setMode('quote'),
  });
  const reserve = useMutation({
    mutationFn: (quoteId: string) =>
      apiClient.request<BookingView>('/bookings', {
        body: JSON.stringify({ quoteId }),
        headers: { 'Idempotency-Key': `mobile-${quoteId}` },
        method: 'POST',
      }),
  });
  const continueBooking = useMutation({
    mutationFn: async (reference: string): Promise<PaymentSetupResult> => {
      const booking = await apiClient.request<BookingView>(`/bookings/${reference}/continue`, {
        method: 'POST',
      });
      const payment = await apiClient.request<{ customerActionUrl: string | null }>(
        `/bookings/${reference}/payment/authorize`,
        { method: 'POST' },
      );
      if (payment.customerActionUrl) await Linking.openURL(payment.customerActionUrl);
      return { booking, customerActionUrl: payment.customerActionUrl };
    },
    onSuccess: ({ booking }) => {
      void client.invalidateQueries({ queryKey: ['bookings'] });
      navigation.navigate('Bookings', { bookingId: booking.publicReference });
    },
  });
  useRefreshOnFocusAndForeground(() => {
    if (mode !== 'detail' && mode !== 'quote') return;
    reserve.reset();
    void invalidateRenterVerification(client);
  });

  function openVehicle(id: string) {
    quote.reset();
    reserve.reset();
    continueBooking.reset();
    const index = sessionRecentlyViewed.indexOf(id);
    if (index >= 0) sessionRecentlyViewed.splice(index, 1);
    sessionRecentlyViewed.unshift(id);
    sessionRecentlyViewed.splice(10);
    detailOrigin.current = mode === 'favorites' ? 'favorites' : 'results';
    setVehicleId(id);
    setMode('detail');
  }
  function performSearch() {
    if (!validDates) return;
    setMode('results');
  }
  async function selectCurrentLocation() {
    setLocationError('');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocationError('Location access was not granted. Choose a city instead.');
      return;
    }
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPlace({
        label: 'Current area',
        detail: 'Based on your device location',
        city: 'Current area',
        province: '',
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
      setLocationOpen(false);
    } catch {
      setLocationError('We could not get your location. Choose a city instead.');
    }
  }

  if (mode === 'favorites')
    return (
      <FavoritesView
        data={favorites.data}
        error={favorites.error}
        loading={favorites.isPending}
        onBack={onExit ?? (() => setMode('form'))}
        onOpen={openVehicle}
        onRemove={(id) => favorite.mutate({ id, active: true })}
      />
    );
  if ((mode === 'detail' || mode === 'quote') && vehicleId)
    return (
      <VehicleView
        key={detail.data?.vehicleId ?? 'loading'}
        vehicle={detail.data}
        loading={detail.isPending}
        error={detail.error}
        pickup={pickup}
        returnAt={returnAt}
        setPickup={setPickup}
        setReturnAt={setReturnAt}
        onBack={() => (initialVehicleId && onExit ? onExit() : setMode(detailOrigin.current))}
        onFavorite={() =>
          detail.data &&
          favorite.mutate({ id: detail.data.vehicleId, active: detail.data.favorite })
        }
        quote={quote}
        reserve={reserve}
        continueBooking={continueBooking}
        mode={mode}
        searchLocation={place}
      />
    );
  if (mode === 'results')
    return (
      <Screen
        scroll={false}
        leading={<BackControl label="Edit search" onPress={() => setMode('form')} />}
        eyebrow="Available cars"
        title={`${searchItems.length} cars loaded near ${place.label}`}
        action={
          <IconButton
            icon="options-outline"
            label="Open filters"
            onPress={() => setFiltersOpen(true)}
          />
        }
      >
        <View style={styles.dateSummary}>
          <Icon color={colors.primary} name="calendar-outline" size={18} />
          <Text numberOfLines={1} style={styles.dateSummaryText}>
            {dateTimeLabel(pickup)} → {dateTimeLabel(returnAt)}
          </Text>
        </View>
        {search.isPending ? (
          <StateView
            loading
            title="Finding cars…"
            message="Checking availability for your dates."
          />
        ) : search.isError && !search.data ? (
          <StateView
            icon="cloud-offline-outline"
            title="Search unavailable"
            message={search.error.message}
            actionLabel="Retry"
            onAction={() => void search.refetch()}
          />
        ) : (
          <FlatList
            ref={resultListRef}
            data={searchItems}
            keyExtractor={(item) => item.vehicleId}
            contentContainerStyle={styles.resultList}
            onContentSizeChange={() => {
              if (resultScrollOffset.current > 0)
                resultListRef.current?.scrollToOffset({
                  animated: false,
                  offset: resultScrollOffset.current,
                });
            }}
            onEndReached={() => {
              if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
            }}
            onEndReachedThreshold={0.25}
            onScroll={(event) => {
              resultScrollOffset.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={100}
            renderItem={({ item }) => (
              <VehicleCard
                vehicle={item}
                onOpen={() => openVehicle(item.vehicleId)}
                onFavorite={() => favorite.mutate({ id: item.vehicleId, active: item.favorite })}
              />
            )}
            ListEmptyComponent={
              <StateView
                icon="search-outline"
                title="No cars found"
                message={
                  handover === 'ANY'
                    ? 'Try a nearby city, wider radius, or different dates.'
                    : 'No cars match this handover option. Try another handover option or expand your search.'
                }
                actionLabel="Change search"
                onAction={() => setMode('form')}
              />
            }
            ListFooterComponent={
              search.isFetchingNextPage ? (
                <StateView loading title="Loading more cars…" />
              ) : nextPageError ? (
                <StateView
                  icon="cloud-offline-outline"
                  title="Couldn’t load more cars"
                  message={nextPageError.message}
                  actionLabel="Retry"
                  onAction={() => void fetchNextSearchPage()}
                />
              ) : searchItems.length > 0 && !search.hasNextPage ? (
                <Text style={styles.endOfResults}>You’ve reached the end of these results.</Text>
              ) : null
            }
          />
        )}
        {filtersOpen && (
          <FilterSheet
            {...{
              filtersOpen,
              setFiltersOpen,
              radiusKm,
              setRadiusKm,
              make,
              setMake,
              categoryId,
              setCategoryId,
              seats,
              setSeats,
              transmission,
              setTransmission,
              powertrain,
              setPowertrain,
              minPrice,
              setMinPrice,
              maxPrice,
              setMaxPrice,
              handover,
              setHandover,
            }}
            onApply={() => {
              setFiltersOpen(false);
            }}
          />
        )}
      </Screen>
    );

  return (
    <Screen
      eyebrow={home ? 'Good day' : 'Find a car'}
      title={home ? 'Where do you need a car?' : 'Search cars'}
      subtitle="Book verified cars from local owners across the Philippines."
      action={
        <IconButton
          icon="heart-outline"
          label="Open favorites"
          onPress={() => setMode('favorites')}
        />
      }
    >
      <Card style={styles.searchCard}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setLocationOpen(true)}
          style={styles.searchRow}
        >
          <View style={styles.searchIcon}>
            <Icon color={colors.primary} name="location-outline" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.smallLabel}>Pickup area</Text>
            <Text style={styles.searchValue}>{place.label}</Text>
            <Text numberOfLines={1} style={styles.searchDetail}>
              {place.detail}
            </Text>
          </View>
          <Icon color={colors.subtleText} name="chevron-down" size={18} />
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.dateGrid}>
          <DateTimeField
            label="Pickup"
            value={pickup}
            minimumDate={new Date()}
            onChange={setPickup}
          />
          <DateTimeField
            label="Return"
            value={returnAt}
            minimumDate={pickup}
            onChange={setReturnAt}
          />
        </View>
        {!validDates && <Text style={styles.error}>Return must be after pickup.</Text>}
        <Button disabled={!validDates} icon="search" label="Search cars" onPress={performSearch} />
      </Card>
      <View style={styles.quickRow}>
        <Chip
          icon="options-outline"
          label={
            activeFilterCount({
              make,
              categoryId,
              seats,
              transmission,
              powertrain,
              minPrice,
              maxPrice,
              handover: handover === 'ANY' ? '' : handover,
            })
              ? `${activeFilterCount({ make, categoryId, seats, transmission, powertrain, minPrice, maxPrice, handover: handover === 'ANY' ? '' : handover })} filters`
              : 'Filters'
          }
          onPress={() => setFiltersOpen(true)}
        />
        <Chip
          icon="navigate-outline"
          label={`${radiusKm} km radius`}
          onPress={() => setFiltersOpen(true)}
        />
      </View>
      {home && (
        <>
          <SectionHeader title="Popular near you" />
          <Text style={styles.sectionCopy}>
            Available for your selected dates. Final price is confirmed before you reserve.
          </Text>
          {search.isPending && <StateView loading title="Loading nearby cars…" />}
          {search.isError && (
            <StateView
              icon="cloud-offline-outline"
              title="Couldn’t load nearby cars"
              message={search.error.message}
              actionLabel="Retry"
              onAction={() => void search.refetch()}
            />
          )}
          {searchItems.slice(0, 4).map((vehicle) => (
            <VehicleCard
              key={vehicle.vehicleId}
              vehicle={vehicle}
              onOpen={() => openVehicle(vehicle.vehicleId)}
              onFavorite={() =>
                favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
              }
            />
          ))}
          {searchItems.length === 0 && (
            <StateView
              icon="car-outline"
              title="No cars nearby yet"
              message="Try another city or widen your search radius."
            />
          )}
        </>
      )}
      <LocationSheet
        open={locationOpen}
        selected={place}
        onClose={() => setLocationOpen(false)}
        onSelect={(next) => {
          setPlace(next);
          setLocationOpen(false);
        }}
        onCurrent={() => void selectCurrentLocation()}
        error={locationError}
      />
      <FilterSheet
        {...{
          filtersOpen,
          setFiltersOpen,
          radiusKm,
          setRadiusKm,
          make,
          setMake,
          categoryId,
          setCategoryId,
          seats,
          setSeats,
          transmission,
          setTransmission,
          powertrain,
          setPowertrain,
          minPrice,
          setMinPrice,
          maxPrice,
          setMaxPrice,
          handover,
          setHandover,
        }}
        onApply={() => setFiltersOpen(false)}
      />
    </Screen>
  );
}

function VehicleCard({
  vehicle,
  onOpen,
  onFavorite,
}: {
  readonly vehicle: VehicleCardView;
  readonly onOpen: () => void;
  readonly onFavorite: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.vehicleCard}>
      <View>
        <VehicleImage contentPath={vehicle.coverPhoto?.contentPath} style={styles.cardImage} />
        <View style={styles.favorite}>
          <IconButton
            active={vehicle.favorite}
            icon={vehicle.favorite ? 'heart' : 'heart-outline'}
            label={vehicle.favorite ? 'Remove from favorites' : 'Save to favorites'}
            onPress={onFavorite}
          />
        </View>
      </View>
      <View style={styles.vehicleContent}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={styles.vehicleTitle}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            <Text numberOfLines={1} style={styles.location}>
              {vehicle.approximateLocation.city}, {vehicle.approximateLocation.province} ·{' '}
              {vehicle.distanceKm.toFixed(1)} km
            </Text>
          </View>
          <View style={styles.priceBox}>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.cardPrice}>
              {money(vehicle.displayPrice.amountMinor, vehicle.currency)}
            </Text>
            <Text style={styles.perDay}>/ day</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          {vehicle.rating && (
            <Text style={styles.meta}>
              ★ {vehicle.rating.averageRating ?? 'New'}{' '}
              {vehicle.rating.reviewCount > 0 ? `(${vehicle.rating.reviewCount})` : ''}
            </Text>
          )}
          <Text style={styles.meta}>
            {vehicle.category?.name ?? 'Vehicle'} · {domainLabel(vehicle.transmission)} ·{' '}
            {vehicle.seats ?? '—'} seats
          </Text>
        </View>
        <View accessibilityLabel="Available handover options" style={styles.quickRow}>
          {vehicle.fulfillment.renterPickupAvailable && <StatusBadge label="Pickup" />}
          {vehicle.fulfillment.deliveryToSearchLocation === true ? (
            <StatusBadge label="Delivery to your location" />
          ) : (
            vehicle.fulfillment.ownerDeliveryAvailable && <StatusBadge label="Delivery" />
          )}
        </View>
        {vehicle.fulfillment.deliveryToSearchLocationReason === 'INSUFFICIENT_NOTICE' &&
          typeof vehicle.fulfillment.fulfillmentMinimumNoticeMinutes === 'number' && (
            <Text style={styles.note}>
              Delivery requires {noticeLabel(vehicle.fulfillment.fulfillmentMinimumNoticeMinutes)}{' '}
              notice.
            </Text>
          )}
        {vehicle.estimatedRentalTotal && (
          <Text style={styles.estimate}>
            Estimated total {money(vehicle.estimatedRentalTotal.amountMinor, vehicle.currency)} for{' '}
            {vehicle.estimatedRentalTotal.chargeableDays} day
            {vehicle.estimatedRentalTotal.chargeableDays === 1 ? '' : 's'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function VehicleView(properties: {
  readonly vehicle?: VehicleDetail | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly pickup: Date;
  readonly returnAt: Date;
  readonly setPickup: (value: Date) => void;
  readonly setReturnAt: (value: Date) => void;
  readonly onBack: () => void;
  readonly onFavorite: () => void;
  readonly quote: ReturnType<typeof useMutation<Quote, Error, QuoteFulfillmentInput>>;
  readonly reserve: ReturnType<typeof useMutation<BookingView, Error, string>>;
  readonly continueBooking: ReturnType<typeof useMutation<PaymentSetupResult, Error, string>>;
  readonly mode: ViewMode;
  readonly searchLocation: SearchLocation;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { vehicle } = properties;
  const { width: viewportWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const quotePosition = useRef(0);
  const lastScrolledQuoteId = useRef<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [startMethod, setStartMethod] = useState<'RENTER_PICKUP' | 'OWNER_DELIVERY'>(
    vehicle?.fulfillment.renterPickupAvailable === false &&
      vehicle.fulfillment.ownerDeliveryAvailable
      ? 'OWNER_DELIVERY'
      : 'RENTER_PICKUP',
  );
  const [endMethod, setEndMethod] = useState<'RENTER_RETURN' | 'OWNER_COLLECTION'>(
    vehicle?.fulfillment.renterReturnAvailable === false &&
      vehicle.fulfillment.ownerCollectionAvailable
      ? 'OWNER_COLLECTION'
      : 'RENTER_RETURN',
  );
  const [sameAsDelivery, setSameAsDelivery] = useState(true);
  const [deliveryLocation, setDeliveryLocation] = useState<CarShareLocation>();
  const [collectionLocation, setCollectionLocation] = useState<CarShareLocation>();
  const [picker, setPicker] = useState<'delivery' | 'collection' | null>(null);
  const quoteData = properties.quote.data;
  if (properties.loading)
    return (
      <Screen
        leading={<BackControl label="Back to results" onPress={properties.onBack} />}
        title="Vehicle details"
      >
        <StateView loading title="Loading car…" />
      </Screen>
    );
  if (properties.error || !vehicle)
    return (
      <Screen
        leading={<BackControl label="Back to results" onPress={properties.onBack} />}
        title="Vehicle details"
      >
        <StateView
          icon="alert-circle-outline"
          title="Car unavailable"
          message={properties.error?.message ?? 'This listing is no longer available.'}
          actionLabel="Back to results"
          onAction={properties.onBack}
        />
      </Screen>
    );
  const durationDiscounts = positiveDurationDiscounts(vehicle.pricing.durationDiscounts);
  const selectedChargeableDays = chargeableDays(properties.pickup, properties.returnAt);
  const discountMessage = durationDiscountMessage(selectedChargeableDays, durationDiscounts);
  const destination = (location: CarShareLocation): FulfillmentDestination => ({
    ...(location.addressLine1 ? { addressLine1: location.addressLine1 } : {}),
    ...(location.barangay ? { barangay: location.barangay } : {}),
    city: location.city,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(location.postalCode ? { postalCode: location.postalCode } : {}),
    province: location.province,
  });
  const fulfillmentInput = (): QuoteFulfillmentInput => ({
    collectionSameAsDelivery:
      startMethod === 'OWNER_DELIVERY' && endMethod === 'OWNER_COLLECTION' && sameAsDelivery,
    ...(endMethod === 'OWNER_COLLECTION' && !(startMethod === 'OWNER_DELIVERY' && sameAsDelivery)
      ? {
          collectionDestination: destination(collectionLocation!),
        }
      : {}),
    ...(startMethod === 'OWNER_DELIVERY'
      ? {
          deliveryDestination: destination(deliveryLocation!),
        }
      : {}),
    endMethod,
    startMethod,
  });
  const fulfillmentValid =
    (startMethod !== 'OWNER_DELIVERY' || Boolean(deliveryLocation)) &&
    (endMethod !== 'OWNER_COLLECTION' ||
      (startMethod === 'OWNER_DELIVERY' && sameAsDelivery) ||
      Boolean(collectionLocation));
  return (
    <Screen
      scrollRef={scrollRef}
      leading={<BackControl label="Back to results" onPress={properties.onBack} />}
      eyebrow="Vehicle details"
      title={`${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim()}
      action={
        <IconButton
          active={vehicle.favorite}
          icon={vehicle.favorite ? 'heart' : 'heart-outline'}
          label="Favorite"
          onPress={properties.onFavorite}
        />
      }
    >
      <ScrollView
        horizontal
        onMomentumScrollEnd={(event) =>
          setGalleryIndex(Math.round(event.nativeEvent.contentOffset.x / viewportWidth))
        }
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.gallery}
      >
        {(vehicle.photos?.length ? vehicle.photos : [{ id: 'fallback', contentPath: '' }]).map(
          (photo) => (
            <Pressable key={photo.id} onPress={() => setGalleryOpen(true)}>
              <VehicleImage
                contentPath={photo.contentPath}
                style={[styles.heroImage, { width: viewportWidth }]}
              />
            </Pressable>
          ),
        )}
      </ScrollView>
      <View pointerEvents="none" style={styles.galleryIndicator}>
        <Text style={styles.galleryIndicatorText}>
          {galleryIndex + 1} / {Math.max(1, vehicle.photos?.length ?? 0)}
        </Text>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setGalleryOpen(false)}
        visible={galleryOpen}
      >
        <View style={styles.fullGallery}>
          <IconButton icon="close" label="Close gallery" onPress={() => setGalleryOpen(false)} />
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {(vehicle.photos?.length ? vehicle.photos : [{ id: 'fallback', contentPath: '' }]).map(
              (photo) => (
                <VehicleImage
                  key={photo.id}
                  contentPath={photo.contentPath}
                  resizeMode="contain"
                  style={{ height: '100%', width: viewportWidth }}
                />
              ),
            )}
          </ScrollView>
        </View>
      </Modal>
      <View style={styles.detailMeta}>
        <StatusBadge
          label={
            vehicle.rating?.averageRating
              ? `★ ${vehicle.rating.averageRating} · ${vehicle.rating.reviewCount} reviews`
              : 'New listing'
          }
        />
        <View style={styles.locationRow}>
          <Icon color={colors.subtleText} name="location-outline" size={15} />
          <Text style={styles.location}>
            {vehicle.location.city}, {vehicle.location.province}
          </Text>
        </View>
      </View>
      <View style={styles.priceLine}>
        <Text style={styles.detailPrice}>
          {money(vehicle.pricing.dailyRateMinor, vehicle.pricing.currency)}
        </Text>
        <Text style={styles.perDay}> per day</Text>
      </View>
      {durationDiscounts.length > 0 && (
        <Card style={styles.discountCard}>
          <View style={styles.discountHeading}>
            <Icon color={colors.primary} name="sparkles-outline" size={20} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Save more on longer trips</Text>
              <Text style={styles.note}>
                Discount is applied automatically when your rental dates qualify.
              </Text>
            </View>
          </View>
          <View style={styles.discountTiers}>
            {durationDiscounts.map((tier) => (
              <View key={tier.minimumDays} style={styles.discountTier}>
                <Text style={styles.discountDays}>{tier.minimumDays}+ days</Text>
                <Text style={styles.discountValue}>Save {percentageLabel(tier.discountBps)}</Text>
              </View>
            ))}
          </View>
          {discountMessage && (
            <View style={styles.discountMessage}>
              <Icon color={colors.primaryDark} name="calendar-outline" size={16} />
              <Text style={styles.discountMessageText}>{discountMessage}</Text>
            </View>
          )}
        </Card>
      )}
      <Card style={styles.tripCard}>
        <SectionHeader title="Your trip" />
        <View style={styles.dateGrid}>
          <DateTimeField
            label="Pickup"
            value={properties.pickup}
            minimumDate={new Date()}
            onChange={properties.setPickup}
          />
          <DateTimeField
            label="Return"
            value={properties.returnAt}
            minimumDate={properties.pickup}
            onChange={properties.setReturnAt}
          />
        </View>
        <SectionHeader title="How would you like to receive the car?" />
        <View style={styles.quickRow}>
          {vehicle.fulfillment.renterPickupAvailable && (
            <Chip
              label="Pick up the car"
              selected={startMethod === 'RENTER_PICKUP'}
              onPress={() => {
                setStartMethod('RENTER_PICKUP');
                properties.quote.reset();
              }}
            />
          )}
          {vehicle.fulfillment.ownerDeliveryAvailable && (
            <Chip
              label="Have it delivered"
              selected={startMethod === 'OWNER_DELIVERY'}
              onPress={() => {
                setStartMethod('OWNER_DELIVERY');
                properties.quote.reset();
              }}
            />
          )}
        </View>
        {startMethod === 'OWNER_DELIVERY' && (
          <ConfirmedLocationCard
            kind="delivery"
            location={deliveryLocation}
            onChange={() => setPicker('delivery')}
          />
        )}
        <SectionHeader title="How would you like to return the car?" />
        <View style={styles.quickRow}>
          {vehicle.fulfillment.renterReturnAvailable && (
            <Chip
              label="Return it yourself"
              selected={endMethod === 'RENTER_RETURN'}
              onPress={() => {
                setEndMethod('RENTER_RETURN');
                properties.quote.reset();
              }}
            />
          )}
          {vehicle.fulfillment.ownerCollectionAvailable && (
            <Chip
              label="Have the owner collect it"
              selected={endMethod === 'OWNER_COLLECTION'}
              onPress={() => {
                setEndMethod('OWNER_COLLECTION');
                properties.quote.reset();
              }}
            />
          )}
        </View>
        {endMethod === 'OWNER_COLLECTION' && startMethod === 'OWNER_DELIVERY' && (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sameAsDelivery }}
            onPress={() => {
              setSameAsDelivery(!sameAsDelivery);
              if (sameAsDelivery) setCollectionLocation(undefined);
              properties.quote.reset();
            }}
            style={styles.locationRow}
          >
            <Icon
              color={colors.primary}
              name={sameAsDelivery ? 'checkbox' : 'square-outline'}
              size={22}
            />
            <Text style={styles.body}>Same as delivery location</Text>
          </Pressable>
        )}
        {endMethod === 'OWNER_COLLECTION' &&
          !(startMethod === 'OWNER_DELIVERY' && sameAsDelivery) && (
            <ConfirmedLocationCard
              kind="collection"
              location={collectionLocation}
              onChange={() => setPicker('collection')}
            />
          )}
        {picker && (
          <LocationPicker
            visible
            kind={picker}
            initial={picker === 'collection' ? collectionLocation : deliveryLocation}
            onCancel={() => setPicker(null)}
            onConfirm={(location) => {
              if (picker === 'delivery') setDeliveryLocation(location);
              else setCollectionLocation(location);
              properties.quote.reset();
              setPicker(null);
            }}
          />
        )}
        <Text style={styles.quoteNote}>Checking the price does not reserve this car.</Text>
        <Button
          disabled={
            properties.quote.isPending ||
            properties.returnAt <= properties.pickup ||
            !fulfillmentValid
          }
          label={properties.quote.isPending ? 'Checking price…' : 'Check price'}
          onPress={() => properties.quote.mutate(fulfillmentInput())}
        />
      </Card>
      {properties.quote.isError && (
        <StateView
          icon="alert-circle-outline"
          title="Price unavailable"
          message={properties.quote.error.message}
        />
      )}
      {properties.mode === 'quote' && quoteData && (
        <View
          onLayout={(event) => {
            quotePosition.current = event.nativeEvent.layout.y;
            if (lastScrolledQuoteId.current === quoteData.id) return;
            lastScrolledQuoteId.current = quoteData.id;
            requestAnimationFrame(() =>
              scrollRef.current?.scrollTo({
                animated: true,
                y: Math.max(0, quotePosition.current - spacing.sm),
              }),
            );
          }}
        >
          <QuoteCard
            quote={quoteData}
            vehicle={vehicle}
            pickup={properties.pickup}
            returnAt={properties.returnAt}
            reserve={properties.reserve}
            continueBooking={properties.continueBooking}
            onRefreshQuote={() => {
              properties.reserve.reset();
              properties.continueBooking.reset();
              properties.quote.mutate(fulfillmentInput());
            }}
          />
        </View>
      )}
      <SectionHeader title="Vehicle details" />
      <Card>
        <DetailRow
          icon="car-outline"
          label="Category"
          value={vehicle.category?.name ?? 'Vehicle'}
        />
        <DetailRow
          icon="options-outline"
          label="Transmission"
          value={domainLabel(vehicle.transmission)}
        />
        <DetailRow
          icon="people-outline"
          label="Seats"
          value={vehicle.seats ? `${vehicle.seats} seats` : 'Not specified'}
        />
        <DetailRow
          icon="flash-outline"
          label="Powertrain"
          value={domainLabel(vehicle.powertrain ?? vehicle.fuelType)}
        />
      </Card>
      <SectionHeader title="Features" />
      <View style={styles.quickRow}>
        {vehicle.features.length ? (
          vehicle.features.map((feature) => <Chip key={feature.id} label={feature.name} />)
        ) : (
          <Text style={styles.body}>No features listed.</Text>
        )}
      </View>
      <SectionHeader title="Mileage & return policies" />
      <Card>
        <Text style={styles.cardTitle}>
          {vehicle.mileagePolicy.type === 'UNLIMITED'
            ? 'Unlimited mileage'
            : `${vehicle.mileagePolicy.includedKilometersPerChargeableDay} km included per rental day`}
        </Text>
        {typeof vehicle.mileagePolicy.excessKilometerRateMinor === 'number' &&
          vehicle.mileagePolicy.excessKilometerRateMinor > 0 && (
            <Text style={styles.body}>
              {money(vehicle.mileagePolicy.excessKilometerRateMinor)} per excess whole kilometer,
              based on inspection readings.
            </Text>
          )}
        <Text style={styles.body}>
          {vehicle.powertrain === 'BATTERY_ELECTRIC'
            ? `Battery return: ${domainLabel(vehicle.returnPolicy?.ev)}`
            : `Fuel return: ${domainLabel(vehicle.returnPolicy?.fuel)}`}
        </Text>
        {typeof vehicle.turnaroundMinutes === 'number' && vehicle.turnaroundMinutes > 0 && (
          <Text style={styles.note}>
            The owner allows {vehicle.turnaroundMinutes / 60} hours between rentals for preparation.
          </Text>
        )}
      </Card>
      <SectionHeader title="Handover options" />
      <Card>
        <Text style={styles.cardTitle}>Start of rental</Text>
        <Text style={styles.body}>
          {[
            vehicle.fulfillment.renterPickupAvailable ? 'Pick up from the owner’s area' : null,
            vehicle.fulfillment.ownerDeliveryAvailable ? 'Owner delivery may be available' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'No start handover option is currently published.'}
        </Text>
        <Text style={styles.note}>
          Pickup area: {vehicle.location.city}, {vehicle.location.province}
        </Text>
        <Text style={styles.cardTitle}>End of rental</Text>
        <Text style={styles.body}>
          {[
            vehicle.fulfillment.renterReturnAvailable ? 'Return the car yourself' : null,
            vehicle.fulfillment.ownerCollectionAvailable
              ? 'Owner collection may be available'
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'No return handover option is currently published.'}
        </Text>
        {vehicle.fulfillment.ownerDeliveryAvailable && (
          <Text style={styles.note}>
            Delivery policy:{' '}
            {fulfillmentFeeLabel(vehicle.fulfillment.deliveryFeeMinor, vehicle.pricing.currency)}
            {vehicle.fulfillment.fulfillmentServiceRadiusMeters
              ? ` within approximately ${Math.round(vehicle.fulfillment.fulfillmentServiceRadiusMeters / 1000)} km`
              : ''}
            .
          </Text>
        )}
        {vehicle.fulfillment.ownerCollectionAvailable && (
          <Text style={styles.note}>
            Collection policy:{' '}
            {fulfillmentFeeLabel(vehicle.fulfillment.collectionFeeMinor, vehicle.pricing.currency)}.
          </Text>
        )}
        {(vehicle.fulfillment.ownerDeliveryAvailable ||
          vehicle.fulfillment.ownerCollectionAvailable) && (
          <View>
            <Text style={styles.cardTitle}>Delivery & collection notice</Text>
            <Text style={styles.note}>
              {vehicle.fulfillment.fulfillmentMinimumNoticeMinutes
                ? `Requires at least ${noticeLabel(vehicle.fulfillment.fulfillmentMinimumNoticeMinutes)} advance notice.`
                : 'No minimum notice.'}
            </Text>
            <Text style={styles.note}>
              This notice period only applies to owner delivery or collection.
            </Text>
          </View>
        )}
        <Text style={styles.note}>
          Actual booking total and handover eligibility are confirmed during booking.
        </Text>
      </Card>
      <SectionHeader title="Your host" />
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          navigation.navigate('HostProfile', { hostReference: vehicle.owner.publicReference })
        }
      >
        <Card style={styles.ownerCard}>
          <View style={styles.ownerAvatar}>
            <Icon color={colors.primary} name="person" />
          </View>
          <View style={styles.flex}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{vehicle.owner.displayName}</Text>
              {vehicle.owner.verified && (
                <Icon color={colors.primary} name="checkmark-circle" size={18} />
              )}
            </View>
            <Text style={styles.body}>
              {vehicle.owner.rating?.averageRating
                ? `★ ${vehicle.owner.rating.averageRating} · ${vehicle.owner.rating.reviewCount} reviews`
                : 'Verified owner · New host'}
            </Text>
          </View>
        </Card>
      </Pressable>
      {vehicle.rating?.reviewCount ? (
        <Button
          label={`Read all ${vehicle.rating.reviewCount} vehicle reviews`}
          onPress={() =>
            navigation.navigate('PublicReviews', {
              path: `/vehicles/${vehicle.vehicleId}/reviews`,
              title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            })
          }
          variant="secondary"
        />
      ) : null}
      {vehicle.description && (
        <>
          <SectionHeader title="About this car" />
          <Text style={styles.description}>{vehicle.description}</Text>
        </>
      )}
      <SectionHeader title="Booking & cancellation" />
      <Card>
        <Text style={styles.cardTitle}>Rental requirements</Text>
        <Text style={styles.body}>
          {vehicle.rentalRequirements ??
            'Bring the verified identity and driving documents required for pickup.'}
        </Text>
        <Text style={styles.note}>
          Cancellation availability and payment consequences are checked against the live booking
          state. The app asks for confirmation before a request is cancelled.
        </Text>
      </Card>
    </Screen>
  );
}

function QuoteCard({
  quote,
  vehicle,
  pickup,
  returnAt,
  reserve,
  continueBooking,
  onRefreshQuote,
}: {
  readonly quote: Quote;
  readonly vehicle: VehicleDetail;
  readonly pickup: Date;
  readonly returnAt: Date;
  readonly reserve: ReturnType<typeof useMutation<BookingView, Error, string>>;
  readonly continueBooking: ReturnType<typeof useMutation<PaymentSetupResult, Error, string>>;
  readonly onRefreshQuote: () => void;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const expiryTime = timeLabel(quote.expiresAt);
  return (
    <Card style={styles.quoteCard}>
      <SectionHeader title="Price summary" />
      <Text style={styles.cardTitle}>
        {vehicle.year} {vehicle.make} {vehicle.model}
      </Text>
      <Text style={styles.body}>
        {dateTimeLabel(pickup)} → {dateTimeLabel(returnAt)}
      </Text>
      <Text style={styles.body}>
        Start: {fulfillmentMethodLabel(quote.fulfillment.startMethod)} ·{' '}
        {locationLabel(quote.fulfillment.startLocation)}
      </Text>
      <Text style={styles.body}>
        End: {fulfillmentMethodLabel(quote.fulfillment.endMethod)} ·{' '}
        {locationLabel(quote.fulfillment.endLocation)}
      </Text>
      <Text style={styles.body}>
        {money(vehicle.pricing.dailyRateMinor, quote.currency)} per day · {quote.chargeableDays}{' '}
        chargeable day{quote.chargeableDays === 1 ? '' : 's'}
      </Text>
      {quote.lines.map((line) => (
        <View key={line.code} style={styles.line}>
          <Text style={styles.body}>{line.description}</Text>
          <Text style={styles.lineMoney}>{money(line.amountMinor, quote.currency)}</Text>
        </View>
      ))}
      {quote.durationDiscountAmountMinor > 0 && (
        <Text style={styles.savings}>
          You save {money(quote.durationDiscountAmountMinor, quote.currency)} on this{' '}
          {quote.chargeableDays}-day booking.
        </Text>
      )}
      <View style={styles.totalLine}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{money(quote.totalMinor, quote.currency)}</Text>
      </View>
      <Text style={styles.note}>
        Price confirmed until {expiryTime}. Checking the price does not reserve this car.
      </Text>
      {!reserve.data && (
        <Button
          disabled={reserve.isPending}
          label={reserve.isPending ? 'Reserving…' : 'Reserve car'}
          onPress={() => reserve.mutate(quote.id)}
        />
      )}
      {reserve.isError && (
        <View style={styles.hold}>
          <Text style={styles.error}>{reserve.error.message}</Text>
          {reserve.error instanceof ApiError &&
          reserve.error.code === 'RENTER_VERIFICATION_REQUIRED' ? (
            <>
              <Text style={styles.note}>
                Your quote remains informational until renter verification is approved.
              </Text>
              <Button
                label="Complete renter verification"
                onPress={() => navigation.navigate('Verification')}
                variant="secondary"
              />
            </>
          ) : (
            <>
              <Text style={styles.note}>
                Quotes expire and availability can change before reservation.
              </Text>
              <Button label="Check current price" onPress={onRefreshQuote} variant="secondary" />
            </>
          )}
        </View>
      )}
      {reserve.data && (
        <View style={styles.hold}>
          <Text style={styles.cardTitle}>Car held temporarily</Text>
          <Text style={styles.body}>Reference {reserve.data.publicReference}</Text>
          <Text style={styles.note}>
            {reserve.data.holdExpiresAt
              ? `Complete payment setup by ${dateTimeLabel(reserve.data.holdExpiresAt)}.`
              : 'Complete payment setup soon.'}
          </Text>
          <Button
            disabled={continueBooking.isPending}
            label={continueBooking.isPending ? 'Securing payment…' : 'Authorize payment'}
            onPress={() => continueBooking.mutate(reserve.data!.publicReference)}
          />
          {continueBooking.isError && (
            <Text style={styles.error}>{continueBooking.error.message}</Text>
          )}
        </View>
      )}
    </Card>
  );
}

function ConfirmedLocationCard({
  kind,
  location,
  onChange,
}: {
  readonly kind: 'delivery' | 'collection';
  readonly location: CarShareLocation | undefined;
  readonly onChange: () => void;
}) {
  return (
    <View style={styles.addressFields}>
      <Text style={styles.cardTitle}>
        {kind === 'delivery' ? 'Delivery location' : 'Collection location'}
      </Text>
      {location ? (
        <Text style={styles.body}>{confirmedLocationLabel(location)}</Text>
      ) : (
        <Text style={styles.note}>
          {kind === 'delivery'
            ? 'Where should we deliver the car?'
            : 'Where should the owner collect the car?'}
        </Text>
      )}
      <Button
        label={location ? 'Change location' : `Select ${kind} location`}
        onPress={onChange}
        variant="secondary"
      />
      <Text style={styles.note}>
        Confirm the destination. The server checks the owner’s service area and notice requirement.
      </Text>
    </View>
  );
}

function fulfillmentMethodLabel(method: string) {
  return (
    (
      {
        RENTER_PICKUP: 'Pick up the car',
        OWNER_DELIVERY: 'Owner Delivery',
        RENTER_RETURN: 'Renter Return',
        OWNER_COLLECTION: 'Owner Collection',
      } as Record<string, string>
    )[method] ?? domainLabel(method)
  );
}

function locationLabel(location: FulfillmentDestination) {
  return [location.addressLine1, location.city, location.province].filter(Boolean).join(', ');
}

function FavoritesView({
  data,
  error,
  loading,
  onBack,
  onOpen,
  onRemove,
}: {
  readonly data?:
    { items: readonly { vehicle: VehicleDetail }[]; unavailableCount: number } | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly onOpen: (id: string) => void;
  readonly onRemove: (id: string) => void;
}) {
  return (
    <Screen
      leading={<BackControl label="Back" onPress={onBack} />}
      eyebrow="Saved cars"
      title="Favorites"
      subtitle="Cars you save will appear here."
    >
      {loading && <StateView loading title="Loading saved cars…" />}
      {error && (
        <StateView
          icon="cloud-offline-outline"
          title="Favorites unavailable"
          message={error.message}
        />
      )}
      {data?.unavailableCount ? (
        <Text style={styles.note}>
          {data.unavailableCount} saved car(s) are currently unavailable and hidden.
        </Text>
      ) : null}
      {data?.items.length === 0 && (
        <StateView
          icon="heart-outline"
          title="No favorites yet"
          message="Tap the heart on a car to save it for later."
        />
      )}
      {data?.items.map(({ vehicle }) => (
        <Card key={vehicle.vehicleId} style={styles.favoriteCard}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(vehicle.vehicleId)}
            style={styles.favoriteOpen}
          >
            <VehicleImage
              contentPath={vehicle.photos?.[0]?.contentPath}
              style={styles.favoriteImage}
            />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </Text>
              <Text style={styles.body}>
                {vehicle.location.city}, {vehicle.location.province}
              </Text>
              <Text style={styles.cardPrice}>{money(vehicle.pricing.dailyRateMinor)}</Text>
            </View>
          </Pressable>
          <IconButton
            active
            icon="heart"
            label="Remove from favorites"
            onPress={() => onRemove(vehicle.vehicleId)}
          />
        </Card>
      ))}
    </Screen>
  );
}

function LocationSheet({
  open,
  selected,
  onClose,
  onSelect,
  onCurrent,
  error,
}: {
  readonly open: boolean;
  readonly selected: SearchLocation;
  readonly onClose: () => void;
  readonly onSelect: (value: SearchLocation) => void;
  readonly onCurrent: () => void;
  readonly error: string;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open}
    >
      <Screen
        title="Choose pickup area"
        subtitle="Search uses your area internally. Exact vehicle locations stay private."
      >
        <Button
          icon="navigate-outline"
          label="Use current location"
          onPress={onCurrent}
          variant="secondary"
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {locations.map((location) => (
          <Pressable
            key={location.label}
            onPress={() => onSelect(location)}
            style={styles.locationOption}
          >
            <View style={styles.searchIcon}>
              <Icon color={colors.primary} name="location-outline" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{location.label}</Text>
              <Text style={styles.body}>{location.detail}</Text>
            </View>
            {selected.label === location.label && (
              <Icon color={colors.primary} name="checkmark-circle" />
            )}
          </Pressable>
        ))}
        <Button label="Cancel" onPress={onClose} variant="ghost" />
      </Screen>
    </Modal>
  );
}

type FilterProperties = {
  readonly filtersOpen: boolean;
  readonly setFiltersOpen: (value: boolean) => void;
  readonly radiusKm: number;
  readonly setRadiusKm: (value: number) => void;
  readonly make: string;
  readonly setMake: (value: string) => void;
  readonly categoryId: string;
  readonly setCategoryId: (value: string) => void;
  readonly seats: string;
  readonly setSeats: (value: string) => void;
  readonly transmission: string;
  readonly setTransmission: (value: string) => void;
  readonly powertrain: string;
  readonly setPowertrain: (value: string) => void;
  readonly minPrice: string;
  readonly setMinPrice: (value: string) => void;
  readonly maxPrice: string;
  readonly setMaxPrice: (value: string) => void;
  readonly handover: string;
  readonly setHandover: (value: string) => void;
  readonly onApply: () => void;
};
function FilterSheet(properties: FilterProperties) {
  const reference = useQuery({
    queryKey: ['vehicle-reference-data'],
    queryFn: () =>
      apiClient.request<{ categories: ReferenceOption[]; makes: ReferenceOption[] }>(
        '/vehicles/reference-data',
      ),
  });
  const clear = () => {
    properties.setMake('');
    properties.setCategoryId('');
    properties.setSeats('');
    properties.setTransmission('');
    properties.setPowertrain('');
    properties.setMinPrice('');
    properties.setMaxPrice('');
    properties.setHandover('ANY');
    properties.setRadiusKm(25);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => properties.setFiltersOpen(false)}
      presentationStyle="pageSheet"
      visible={properties.filtersOpen}
    >
      <Screen
        title="Filters"
        subtitle="Narrow the cars shown. Availability and final price are still checked by the platform."
      >
        <SectionHeader title="Search radius" />
        <View style={styles.quickRow}>
          {[5, 10, 25, 50, 100].map((value) => (
            <Chip
              key={value}
              label={`${value} km`}
              selected={properties.radiusKm === value}
              onPress={() => properties.setRadiusKm(value)}
            />
          ))}
        </View>
        <SearchableReferenceSelector
          allowAny
          anyLabel="Any make"
          label="Make"
          options={(reference.data?.makes ?? []).map((item) => ({ ...item, id: item.name }))}
          value={properties.make}
          onChange={properties.setMake}
        />
        <SearchableReferenceSelector
          allowAny
          anyLabel="Any vehicle type"
          label="Vehicle type"
          options={reference.data?.categories ?? []}
          value={properties.categoryId}
          onChange={properties.setCategoryId}
        />
        <SectionHeader title="Advanced filters" />
        <SectionHeader title="Handover" />
        <View accessibilityLabel="Handover filter" style={styles.quickRow}>
          {[
            ['ANY', 'Any'],
            ['PICKUP_AVAILABLE', 'Pickup available'],
            ['DELIVERY_AVAILABLE', 'Delivery available'],
            ['PICKUP_AND_DELIVERY', 'Pickup & delivery available'],
          ].map(([value, label]) => (
            <Chip
              key={value}
              label={label!}
              selected={properties.handover === value}
              onPress={() => properties.setHandover(value!)}
            />
          ))}
        </View>
        <Field
          label="Minimum seats (optional)"
          value={properties.seats}
          onChangeText={properties.setSeats}
          keyboardType="number-pad"
          placeholder="e.g. 5"
        />
        <SectionHeader title="Transmission" />
        <View style={styles.quickRow}>
          {['', 'AUTOMATIC', 'MANUAL', 'CVT'].map((value) => (
            <Chip
              key={value || 'any'}
              label={value ? domainLabel(value) : 'Any'}
              selected={properties.transmission === value}
              onPress={() => properties.setTransmission(value)}
            />
          ))}
        </View>
        <SectionHeader title="Powertrain" />
        <View style={styles.quickRow}>
          {['', 'ICE', 'HYBRID', 'BATTERY_ELECTRIC'].map((value) => (
            <Chip
              key={value || 'any'}
              label={value ? domainLabel(value) : 'Any'}
              selected={properties.powertrain === value}
              onPress={() => properties.setPowertrain(value)}
            />
          ))}
        </View>
        <View style={styles.dateGrid}>
          <Field
            label="Minimum price / day"
            value={properties.minPrice}
            onChangeText={properties.setMinPrice}
            keyboardType="number-pad"
            placeholder="₱"
          />
          <Field
            label="Maximum price / day"
            value={properties.maxPrice}
            onChangeText={properties.setMaxPrice}
            keyboardType="number-pad"
            placeholder="₱"
          />
        </View>
        <Button label="Show cars" onPress={properties.onApply} />
        <Button label="Clear filters" onPress={clear} variant="ghost" />
      </Screen>
    </Modal>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.searchIcon}>
        <Icon color={colors.primary} name={icon} size={19} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.smallLabel}>{label}</Text>
        <Text style={styles.cardTitle}>{value}</Text>
      </View>
    </View>
  );
}
function activeFilterCount(filters: Record<string, string>) {
  return Object.values(filters).filter(Boolean).length;
}

function fulfillmentFeeLabel(amountMinor: number | null | undefined, currency: string) {
  if (amountMinor === 0) return 'Free';
  return amountMinor == null
    ? 'Fee confirmed during booking'
    : `${money(amountMinor, currency)} policy fee`;
}

function noticeLabel(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

const styles = StyleSheet.create({
  addressFields: { gap: spacing.sm },
  body: { color: colors.subtleText, lineHeight: 21 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  cardImage: { height: 190, width: '100%' },
  cardPrice: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  dateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateSummary: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  dateSummaryText: { color: colors.primaryDark, flex: 1, fontSize: 12, fontWeight: '700' },
  description: { color: colors.subtleText, fontSize: 15, lineHeight: 24 },
  detailMeta: { gap: spacing.xs },
  detailPrice: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  discountCard: { gap: spacing.sm },
  discountDays: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  discountHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  discountMessage: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  discountMessageText: { color: colors.primaryDark, flex: 1, fontSize: 13, fontWeight: '700' },
  discountTier: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  discountTiers: { gap: spacing.xs },
  discountValue: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 62,
  },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  error: { color: colors.danger, lineHeight: 20 },
  endOfResults: {
    color: colors.subtleText,
    fontSize: 13,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  estimate: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.sm,
    padding: spacing.xs,
  },
  savings: {
    color: colors.primary,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  favorite: { position: 'absolute', right: spacing.sm, top: spacing.sm },
  favoriteCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  favoriteOpen: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  favoriteImage: { borderRadius: radius.md, height: 88, width: 110 },
  flex: { flex: 1, minWidth: 0 },
  gallery: { marginHorizontal: -spacing.lg },
  galleryIndicator: { alignItems: 'center', marginTop: -42, paddingBottom: spacing.sm },
  galleryIndicatorText: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: radius.pill,
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  fullGallery: { backgroundColor: '#000', flex: 1, paddingTop: 54 },
  heroImage: { height: 265 },
  hold: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  line: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  lineMoney: { color: colors.ink, fontWeight: '700' },
  location: { color: colors.subtleText, fontSize: 13, marginTop: spacing.xxs },
  locationRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs },
  locationOption: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.sm,
  },
  meta: { color: colors.subtleText, fontSize: 12, fontWeight: '600' },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  note: { color: colors.subtleText, fontSize: 12, lineHeight: 18 },
  quoteNote: {
    color: colors.subtleText,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  ownerAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  ownerCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  perDay: { color: colors.subtleText, fontSize: 11 },
  priceBox: { alignItems: 'flex-end', maxWidth: '35%' },
  priceLine: { alignItems: 'baseline', flexDirection: 'row' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quoteCard: { gap: spacing.sm },
  resultList: { gap: spacing.md, paddingBottom: 100 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  searchCard: { gap: spacing.md },
  searchDetail: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  searchIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 62 },
  searchValue: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  sectionCopy: { color: colors.subtleText, lineHeight: 21, marginTop: -spacing.sm },
  smallLabel: {
    color: colors.subtleText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  tripCard: { gap: spacing.sm },
  total: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  totalLabel: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  totalLine: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  vehicleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  vehicleContent: { padding: spacing.md },
  vehicleTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
});
