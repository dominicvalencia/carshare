import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  AccessibilityInfo,
  FlatList,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { ApiError, apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
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
import { bookingLocationProvider } from '../../location/booking-location-provider';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import {
  chargeableDays,
  durationDiscountMessage,
  percentageLabel,
  positiveDurationDiscounts,
  type PublicDurationDiscount,
} from './duration-discount-presentation';
import { DiscoveryMap, type MapSearchArea } from './DiscoveryMap';
import { TripDateCalendar } from './TripDateCalendar';
import { tripDateSummary } from './trip-date-policy';
import { formatResultSummary, uniqueVehicleCount } from './result-summary';
import { areaRailTitle, exploreRailQuery, showTripRail, uniqueRailVehicles } from './explore-rails';
import { committedSearchPayload } from './committed-search-history';
import { PriceRangeSlider } from './PriceRangeSlider';
import { MinimumSeatsSlider } from './MinimumSeatsSlider';
import {
  cloneDiscoveryFilters,
  DEFAULT_DISCOVERY_FILTERS,
  discoveryFiltersEqual,
  priceRangeError,
  type DiscoveryFilters,
} from './filter-draft';
import {
  latestReconstructibleSearch,
  recentVehicleCards,
  type ExploreRailCard,
  type HistorySearchRecord,
  type RecentVehicleRecord,
} from './personalized-rails';
import {
  pendingExploreRecoveryActions,
  recoveryActionCountLabel,
  recoveryActionScopeLabel,
  unseenRecoveryActions,
} from './explore-recovery-actions';
import {
  eligibleForwardRemainder,
  eligibleReverseRemainder,
  forwardSyntheticTarget,
  normalizedDownwardTravel,
  normalizedUpwardTravel,
  reverseCollapseProgress,
} from './results-forward-handoff';

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
  readonly mapPosition?: {
    readonly mapLatitude: number;
    readonly mapLongitude: number;
    readonly precision: 'APPROXIMATE_CELL';
  };
}
interface SearchResponse {
  readonly facets?: {
    readonly pricePerDay: {
      readonly currency: string;
      readonly minMinor: number;
      readonly maxMinor: number;
    } | null;
  };
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
    avatar?: Grant | null;
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
type VehicleGalleryItem = Grant & { readonly id: string };
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
interface PublicHostSummary {
  readonly completedRentalCount: number;
}
interface PublicReviewPreview {
  readonly aggregate: { readonly averageRating: string; readonly reviewCount: number };
  readonly items: readonly {
    readonly id: string;
    readonly rating: number;
    readonly text: string | null;
    readonly createdAt: string;
    readonly author: { readonly profile: { readonly firstName: string | null } | null };
  }[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly nextCursor: string | null };
}
type SearchLocation = LocationSuggestion & { readonly source?: 'DEVICE' | undefined };
type ViewMode = 'form' | 'results' | 'detail' | 'favorites' | 'quote';
type ExploreShortcut = 'ALL' | 'NEARBY' | 'EV' | 'SEVEN_PLUS' | `CATEGORY:${string}` | 'CUSTOM';
type VehicleReferenceData = {
  readonly categories: readonly ReferenceOption[];
  readonly makes: readonly ReferenceOption[];
};
type SearchDraft = {
  readonly place: SearchLocation;
  readonly start: Date;
  readonly end: Date;
  readonly datesExplicit: boolean;
};

const locations = developmentLocationSuggestions;
const sessionRecentlyViewed: string[] = [];
const searchLocationSession = () =>
  `search_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function futureDate(days: number, hour = 9) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function fullMapVisualProgress(progress: number) {
  'worklet';
  return progress > 1 ? 2 - progress : progress;
}

export function DiscoveryScreen({
  home = false,
  initialMode = 'form',
  initialVehicleId,
  onExit,
  onTabBarHiddenChange,
}: {
  readonly home?: boolean;
  readonly initialMode?: 'form' | 'favorites';
  readonly initialVehicleId?: string | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly onTabBarHiddenChange?: ((hidden: boolean) => void) | undefined;
}) {
  const navigation = useNavigation<NavigationProp<RenterTabParamList & RootStackParamList>>();
  const isFocused = useIsFocused();
  const { bottom: bottomSafeArea } = useSafeAreaInsets();
  const mapRestoreBottom = home
    ? 54 + Math.max(bottomSafeArea, 10) + spacing.md
    : Math.max(spacing.md, bottomSafeArea + spacing.xs);
  const client = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<ViewMode>(initialVehicleId ? 'detail' : initialMode);
  const detailOrigin = useRef<ViewMode>(initialMode === 'favorites' ? 'favorites' : 'form');
  const [vehicleId, setVehicleId] = useState<string | null>(initialVehicleId ?? null);
  const [place, setPlace] = useState<SearchLocation>(locations[0]!);
  const [activePlace, setActivePlace] = useState<SearchLocation>(locations[0]!);
  const [pickup, setPickup] = useState(futureDate(1));
  const [returnAt, setReturnAt] = useState(futureDate(2));
  const [radiusKm, setRadiusKm] = useState(25);
  const [activeRadiusKm, setActiveRadiusKm] = useState(25);
  const [selectedMapVehicleId, setSelectedMapVehicleId] = useState<string | null>(null);
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
  const [returnHandover, setReturnHandover] = useState('ANY');
  const [locationError, setLocationError] = useState('');
  const [recoveryActionsOpen, setRecoveryActionsOpen] = useState(false);
  const [recoveryClock, setRecoveryClock] = useState(() => Date.now());
  const seenRecoveryActionKeys = useRef(new Set<string>());
  const recoveryAlertRef = useRef<View>(null);
  const recoveryTitleRef = useRef<Text>(null);
  const [exploreShortcut, setExploreShortcut] = useState<ExploreShortcut>('ALL');
  const [discoveryLocationEstablished, setDiscoveryLocationEstablished] = useState(false);
  const [tripDatesEstablished, setTripDatesEstablished] = useState(false);
  const [exactTimesSelected, setExactTimesSelected] = useState(false);
  const [railFavoriteOverrides, setRailFavoriteOverrides] = useState<Record<string, boolean>>({});
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const initialResultsMapHeight = Math.max(220, Math.min(340, Math.round(viewportHeight * 0.34)));
  const mapCollapseDistance = Math.max(190, Math.min(280, initialResultsMapHeight * 0.85));
  const mapTransientUiDismissOffset = Math.min(32, mapCollapseDistance * 0.15);
  const fullMapGestureThreshold = 72;
  const fullMapPeekHeight = Math.max(88, Math.min(104, 64 + bottomSafeArea));
  const validDates = returnAt.getTime() > pickup.getTime();
  const reference = useQuery({
    enabled: home || filtersOpen,
    queryKey: ['vehicle-reference-data'],
    queryFn: () => apiClient.request<VehicleReferenceData>('/vehicles/reference-data'),
  });
  const categoryShortcuts = useMemo(
    () =>
      ['SUV', 'SEDAN'].flatMap((target) => {
        const category = reference.data?.categories.find(
          ({ code, name }) =>
            code.trim().toUpperCase() === target || name.trim().toUpperCase() === target,
        );
        return category ? [{ ...category, label: target === 'SUV' ? 'SUV' : 'Sedan' }] : [];
      }),
    [reference.data?.categories],
  );
  const resultsFilterCount = activeFilterCount({
    categoryId,
    handover: handover === 'ANY' ? '' : handover,
    returnHandover: returnHandover === 'ANY' ? '' : returnHandover,
    make,
    maxPrice,
    minPrice,
    powertrain,
    seats,
    transmission,
  });
  const deliveryFilterActive =
    handover === 'DELIVERY_AVAILABLE' || handover === 'PICKUP_AND_DELIVERY';
  const activeCriteriaQueryString = useMemo(() => {
    const query = new URLSearchParams({
      latitude: String(activePlace.latitude),
      longitude: String(activePlace.longitude),
      radius: String(activeRadiusKm),
      sort: 'RECOMMENDED',
      start: pickup.toISOString(),
      end: returnAt.toISOString(),
    });
    if (make.trim()) query.set('make', make.trim());
    if (categoryId) query.set('categoryId', categoryId);
    if (seats) query.set('seats', seats);
    if (transmission) query.set('transmission', transmission);
    if (powertrain) query.set('powertrain', powertrain);
    if (minPrice) query.set('minPrice', String(Math.round(Number(minPrice) * 100)));
    if (maxPrice) query.set('maxPrice', String(Math.round(Number(maxPrice) * 100)));
    if (handover !== 'ANY') query.set('handover', handover);
    if (returnHandover !== 'ANY') query.set('returnHandover', returnHandover);
    return query.toString();
  }, [
    make,
    categoryId,
    maxPrice,
    minPrice,
    pickup,
    activePlace,
    activeRadiusKm,
    powertrain,
    returnAt,
    seats,
    transmission,
    handover,
    returnHandover,
  ]);
  const listQueryString = `${activeCriteriaQueryString}&limit=10&mode=LIST`;
  const mapQueryString = `${activeCriteriaQueryString}&limit=50&mode=MAP`;
  const tripRailEligible = showTripRail(tripDatesEstablished, pickup, returnAt);
  const authenticatedRenter = Boolean(user?.roles.includes('RENTER'));
  const areaRailQueryString = exploreRailQuery(activePlace, activeRadiusKm, 'AREA', {
    categoryId,
    handover,
    returnHandover,
    powertrain,
    seats,
  });
  const electricRailQueryString = exploreRailQuery(activePlace, activeRadiusKm, 'ELECTRIC');
  const areaRailSearch = useQuery({
    enabled: home && mode === 'form',
    queryKey: ['public-search', 'rail', areaRailQueryString],
    queryFn: () => apiClient.request<SearchResponse>(`/vehicles/search?${areaRailQueryString}`),
    staleTime: 30_000,
  });
  const electricRailSearch = useQuery({
    enabled: home && mode === 'form',
    queryKey: ['public-search', 'rail', electricRailQueryString],
    queryFn: () => apiClient.request<SearchResponse>(`/vehicles/search?${electricRailQueryString}`),
    staleTime: 30_000,
  });
  const recentSearchHistory = useQuery({
    enabled: home && mode === 'form' && authenticatedRenter,
    queryKey: ['renter-history', 'searches', user?.id],
    queryFn: () =>
      apiClient.request<{ items: readonly HistorySearchRecord[] }>(
        '/me/discovery-history/searches',
      ),
  });
  const recentVehicleHistory = useQuery({
    enabled: home && mode === 'form' && authenticatedRenter,
    queryKey: ['renter-history', 'vehicles', user?.id],
    queryFn: () =>
      apiClient.request<{ items: readonly RecentVehicleRecord[] }>(
        '/me/discovery-history/vehicles',
      ),
  });
  const continuedSearch = recentSearchHistory.isError
    ? null
    : latestReconstructibleSearch(recentSearchHistory.data?.items ?? []);
  const continuedRailQuery = continuedSearch?.query ?? '';
  const continuedRailSearch = useQuery({
    enabled: home && mode === 'form' && Boolean(continuedSearch),
    queryKey: ['public-search', 'rail', 'continue', continuedRailQuery],
    queryFn: () => apiClient.request<SearchResponse>(`/vehicles/search?${continuedRailQuery}`),
    staleTime: 30_000,
  });
  const savedSimilarityQueryString = useMemo(() => {
    if (!discoveryLocationEstablished) return '';
    const query = new URLSearchParams({
      latitude: String(activePlace.latitude),
      longitude: String(activePlace.longitude),
      radius: String(activeRadiusKm),
    });
    if (tripDatesEstablished) {
      query.set('start', pickup.toISOString());
      query.set('end', returnAt.toISOString());
    }
    return query.toString();
  }, [
    activePlace.latitude,
    activePlace.longitude,
    activeRadiusKm,
    discoveryLocationEstablished,
    pickup,
    returnAt,
    tripDatesEstablished,
  ]);
  const savedSimilarity = useQuery({
    enabled: home && mode === 'form' && authenticatedRenter && Boolean(savedSimilarityQueryString),
    queryKey: ['renter-recommendations', 'saved-similar', user?.id, savedSimilarityQueryString],
    queryFn: () =>
      apiClient.request<SearchResponse>(
        `/me/discovery-recommendations/saved-similar?${savedSimilarityQueryString}`,
      ),
    staleTime: 30_000,
  });
  const listSearch = useInfiniteQuery({
    enabled: mode === 'results' || (home && tripRailEligible),
    refetchInterval: mode === 'results' || (home && tripRailEligible) ? 5_000 : false,
    refetchOnMount: 'always',
    queryKey: ['public-search', 'LIST', listQueryString],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.request<SearchResponse>(
        `/vehicles/search?${listQueryString}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor ?? undefined,
  });
  const mapSearch = useQuery({
    enabled: mode === 'results',
    refetchInterval: mode === 'results' ? 5_000 : false,
    refetchOnMount: 'always',
    queryKey: ['public-search', 'MAP', mapQueryString],
    queryFn: () => apiClient.request<SearchResponse>(`/vehicles/search?${mapQueryString}`),
  });
  const renterBookings = useQuery({
    enabled: home,
    queryKey: ['bookings'],
    queryFn: () => apiClient.request<BookingView[]>('/bookings'),
    refetchInterval: home ? 10_000 : false,
  });
  const pendingRecoveryActions = useMemo(
    () => pendingExploreRecoveryActions(renterBookings.data ?? []),
    [renterBookings.data],
  );
  useEffect(() => {
    if (!home || mode !== 'form') return;
    if (!pendingRecoveryActions.length) {
      const timer = setTimeout(() => setRecoveryActionsOpen(false), 0);
      return () => clearTimeout(timer);
    }
    if (unseenRecoveryActions(pendingRecoveryActions, seenRecoveryActionKeys.current)) {
      const timer = setTimeout(() => {
        pendingRecoveryActions.forEach((action) => seenRecoveryActionKeys.current.add(action.key));
        setRecoveryActionsOpen(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [home, mode, pendingRecoveryActions]);
  useEffect(() => {
    if (!recoveryActionsOpen) return;
    const timer = setInterval(() => setRecoveryClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [recoveryActionsOpen]);
  function closeRecoveryActions() {
    setRecoveryActionsOpen(false);
    requestAnimationFrame(() => {
      const target = findNodeHandle(recoveryAlertRef.current);
      if (target) AccessibilityInfo.setAccessibilityFocus(target);
    });
  }
  const searchItems = useMemo(
    () => listSearch.data?.pages.flatMap((page) => page.items) ?? [],
    [listSearch.data?.pages],
  );
  const railVehicles = (vehicles: readonly VehicleCardView[]) =>
    uniqueRailVehicles(vehicles).map((vehicle) => ({
      ...vehicle,
      favorite: railFavoriteOverrides[vehicle.vehicleId] ?? vehicle.favorite,
    }));
  const areaRailItems = railVehicles(areaRailSearch.data?.items ?? []);
  const electricRailItems = railVehicles(electricRailSearch.data?.items ?? []);
  const tripRailItems = tripRailEligible ? railVehicles(searchItems).slice(0, 6) : [];
  const recentRailItems = recentVehicleCards(
    recentVehicleHistory.isError ? [] : (recentVehicleHistory.data?.items ?? []),
  )
    .slice(0, 6)
    .map((vehicle) => ({
      ...vehicle,
      favorite: railFavoriteOverrides[vehicle.vehicleId] ?? vehicle.favorite,
    }));
  const continuedRailItems = railVehicles(
    continuedRailSearch.isError ? [] : (continuedRailSearch.data?.items ?? []),
  );
  const savedSimilarityRailItems = railVehicles(
    savedSimilarity.isError ? [] : (savedSimilarity.data?.items ?? []),
  );
  const mapItems = mapSearch.data?.items ?? [];
  const nextPageError = listSearch.isFetchNextPageError ? listSearch.error : null;
  const fetchNextSearchPage = listSearch.fetchNextPage;
  const resultListRef = useAnimatedRef<FlatList<VehicleCardView>>();
  const resultScrollOffset = useRef(0);
  const collapseProgress = useSharedValue(0);
  const fullMapProgress = useSharedValue(0);
  const fullMapPresentationOnUi = useSharedValue(false);
  const listFullMapEntryAllowed = useSharedValue(false);
  const observedListOffset = useSharedValue(0);
  const listContentHeight = useSharedValue(0);
  const listViewportHeight = useSharedValue(0);
  const syntheticForwardActive = useSharedValue(false);
  const handoffTravel = useSharedValue(-1);
  const handoffStartOffset = useSharedValue(0);
  const topReachedTravel = useSharedValue(-1);
  const reverseRestorationActive = useSharedValue(false);
  const mapButtonShownOnUi = useSharedValue(false);
  const mapFullyCollapsedRef = useRef(false);
  const [mapFullyCollapsed, setMapFullyCollapsed] = useState(false);
  const mapTransientUiDismissedRef = useRef(false);
  const [mapTransientUiDismissKey, setMapTransientUiDismissKey] = useState(0);
  const mapButtonVisibleRef = useRef(false);
  const [mapButtonVisible, setMapButtonVisible] = useState(false);
  const mapRestoreInProgress = useRef(false);
  const [fullMap, setFullMap] = useState(false);
  const [resultsCompositionHeight, setResultsCompositionHeight] = useState(0);
  const splitResultsHeight = Math.max(
    fullMapPeekHeight,
    resultsCompositionHeight - initialResultsMapHeight,
  );
  const fullMapHeight = Math.max(
    initialResultsMapHeight,
    resultsCompositionHeight - fullMapPeekHeight - spacing.sm,
  );
  const fullMapExpansionDistance = Math.max(180, fullMapHeight - initialResultsMapHeight);
  const fullMapHandleRegionHeight = spacing.xs + 28 + StyleSheet.hairlineWidth * 2;
  const fullMapPeekBodyHeight = Math.max(0, fullMapPeekHeight - fullMapHandleRegionHeight);
  const splitListViewportHeight = Math.max(0, splitResultsHeight - fullMapHandleRegionHeight);
  const fullMapGestureStartY = useRef<number | null>(null);
  const fullMapGestureDistance = useRef(0);
  const onResultsScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      observedListOffset.value = Math.max(0, event.contentOffset.y);
    },
    onEndDrag: () => runOnJS(syncObservedListOffset)(observedListOffset.value),
    onMomentumEnd: () => runOnJS(syncObservedListOffset)(observedListOffset.value),
  });

  function syncObservedListOffset(offset: number) {
    const normalizedOffset = Math.max(0, offset);
    resultScrollOffset.current = normalizedOffset;
    const transientUiDismissed = normalizedOffset >= mapTransientUiDismissOffset;
    if (transientUiDismissed !== mapTransientUiDismissedRef.current) {
      mapTransientUiDismissedRef.current = transientUiDismissed;
      if (transientUiDismissed) {
        setMapTransientUiDismissKey((key) => key + 1);
        setSelectedMapVehicleId(null);
      }
    }
  }

  function setCollapseMapButtonVisible(visible: boolean) {
    if (visible === mapButtonVisibleRef.current) return;
    mapButtonVisibleRef.current = visible;
    if (!visible) mapRestoreInProgress.current = false;
    setMapButtonVisible(visible);
  }

  function commitForwardPresentation(collapsed: boolean, actualOffset: number) {
    syncObservedListOffset(actualOffset);
    mapFullyCollapsedRef.current = collapsed;
    setMapFullyCollapsed(collapsed);
    setCollapseMapButtonVisible(collapsed);
  }

  function commitReversePresentation(collapsed: boolean) {
    observedListOffset.value = 0;
    resultScrollOffset.current = 0;
    mapFullyCollapsedRef.current = collapsed;
    setMapFullyCollapsed(collapsed);
    setCollapseMapButtonVisible(collapsed);
    if (!collapsed) {
      cancelAnimation(fullMapProgress);
      fullMapProgress.value = 0;
      fullMapPresentationOnUi.value = false;
    }
  }

  const nativeResultListGesture = useMemo(() => Gesture.Native(), []);
  const forwardResultsGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!fullMap && !mapFullyCollapsed)
        .activeOffsetY(-8)
        .failOffsetX([-14, 14])
        .blocksExternalGesture(nativeResultListGesture)
        .onBegin(() => {
          syntheticForwardActive.value = false;
          handoffTravel.value = -1;
          handoffStartOffset.value = 0;
        })
        .onUpdate((event) => {
          const upwardTravel = normalizedUpwardTravel(event.translationY);
          const nextProgress = Math.max(0, Math.min(1, upwardTravel / mapCollapseDistance));
          collapseProgress.value = nextProgress;
          const shouldShowMapButton = mapButtonShownOnUi.value
            ? nextProgress > 0.65
            : nextProgress >= 0.8;
          if (shouldShowMapButton !== mapButtonShownOnUi.value) {
            mapButtonShownOnUi.value = shouldShowMapButton;
            runOnJS(setCollapseMapButtonVisible)(shouldShowMapButton);
          }
          if (nextProgress < 1) return;
          if (handoffTravel.value < 0) {
            handoffTravel.value = upwardTravel;
            handoffStartOffset.value = observedListOffset.value;
            syntheticForwardActive.value = true;
          }
          const remainder = eligibleForwardRemainder(upwardTravel, handoffTravel.value);
          const maxOffset = Math.max(0, listContentHeight.value - listViewportHeight.value);
          const target = forwardSyntheticTarget(handoffStartOffset.value, remainder, maxOffset);
          scrollTo(resultListRef, 0, target, false);
        })
        .onFinalize(() => {
          const target = collapseProgress.value >= 0.5 ? 1 : 0;
          syntheticForwardActive.value = false;
          handoffTravel.value = -1;
          handoffStartOffset.value = 0;
          runOnJS(commitForwardPresentation)(target === 1, observedListOffset.value);
          collapseProgress.value = withTiming(target, { duration: 180 });
        }),
    // Gesture worklets intentionally close over shared values and discrete JS bridge callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      collapseProgress,
      fullMap,
      handoffStartOffset,
      handoffTravel,
      listContentHeight,
      listViewportHeight,
      mapCollapseDistance,
      mapButtonShownOnUi,
      mapFullyCollapsed,
      nativeResultListGesture,
      observedListOffset,
      resultListRef,
      syntheticForwardActive,
    ],
  );
  const reverseResultsGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!fullMap && mapFullyCollapsed)
        .activeOffsetY(8)
        .failOffsetX([-14, 14])
        .simultaneousWithExternalGesture(nativeResultListGesture)
        .onBegin(() => {
          topReachedTravel.value = -1;
          reverseRestorationActive.value = false;
        })
        .onUpdate((event) => {
          const downwardTravel = normalizedDownwardTravel(event.translationY);
          if (observedListOffset.value > 1) {
            collapseProgress.value = 1;
            topReachedTravel.value = -1;
            reverseRestorationActive.value = false;
            return;
          }
          if (topReachedTravel.value < 0) {
            topReachedTravel.value = downwardTravel;
            reverseRestorationActive.value = true;
          }
          const eligibleRestore = eligibleReverseRemainder(downwardTravel, topReachedTravel.value);
          const nextProgress = reverseCollapseProgress(eligibleRestore, mapCollapseDistance);
          collapseProgress.value = nextProgress;
          const shouldShowMapButton = mapButtonShownOnUi.value
            ? nextProgress > 0.65
            : nextProgress >= 0.8;
          if (shouldShowMapButton !== mapButtonShownOnUi.value) {
            mapButtonShownOnUi.value = shouldShowMapButton;
            runOnJS(setCollapseMapButtonVisible)(shouldShowMapButton);
          }
        })
        .onFinalize(() => {
          const target = reverseRestorationActive.value && collapseProgress.value <= 0.5 ? 0 : 1;
          topReachedTravel.value = -1;
          reverseRestorationActive.value = false;
          runOnJS(commitReversePresentation)(target === 1);
          collapseProgress.value = withTiming(target, { duration: 180 });
        }),
    // Reverse worklets intentionally close over shared values and discrete JS bridge callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      collapseProgress,
      fullMap,
      mapButtonShownOnUi,
      mapCollapseDistance,
      mapFullyCollapsed,
      nativeResultListGesture,
      observedListOffset,
      reverseRestorationActive,
      topReachedTravel,
    ],
  );
  const listFullMapEntryGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!fullMap && !mapFullyCollapsed)
        .activeOffsetY(2)
        .failOffsetX([-14, 14])
        .simultaneousWithExternalGesture(nativeResultListGesture)
        .onStart(() => {
          // A new pull may expand the map only from settled SPLIT at the list top.
          // A FULL_LIST reverse pull begins with this gesture disabled, so it still pins at SPLIT.
          const allowed = observedListOffset.value <= 1 && collapseProgress.value <= 0.01;
          listFullMapEntryAllowed.value = allowed;
          if (!allowed) return;
          cancelAnimation(fullMapProgress);
          fullMapProgress.value = 0;
          fullMapPresentationOnUi.value = true;
          runOnJS(beginFullMapGesture)();
        })
        .onUpdate((event) => {
          if (!listFullMapEntryAllowed.value) return;
          fullMapProgress.value = Math.min(
            1,
            Math.max(0, event.translationY) / fullMapExpansionDistance,
          );
        })
        .onFinalize((event) => {
          if (!listFullMapEntryAllowed.value) return;
          listFullMapEntryAllowed.value = false;
          runOnJS(finishFullMapEntryGesture)(event.translationY);
        }),
    // Gesture worklets intentionally close over shared values and discrete JS bridge callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      collapseProgress,
      fullMap,
      fullMapExpansionDistance,
      fullMapPresentationOnUi,
      fullMapProgress,
      listFullMapEntryAllowed,
      mapFullyCollapsed,
      nativeResultListGesture,
      observedListOffset,
    ],
  );
  const resultsGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Race(forwardResultsGesture, reverseResultsGesture),
        listFullMapEntryGesture,
      ),
    [forwardResultsGesture, listFullMapEntryGesture, reverseResultsGesture],
  );
  const handleFullMapEntryGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!fullMap && !mapFullyCollapsed)
        .activeOffsetY(2)
        .simultaneousWithExternalGesture(forwardResultsGesture, reverseResultsGesture)
        .onStart(() => {
          cancelAnimation(fullMapProgress);
          fullMapProgress.value = 0;
          fullMapPresentationOnUi.value = true;
          runOnJS(beginFullMapGesture)();
        })
        .onUpdate((event) => {
          fullMapProgress.value = Math.min(
            1,
            Math.max(0, event.translationY) / fullMapExpansionDistance,
          );
        })
        .onFinalize((event) => runOnJS(finishFullMapEntryGesture)(event.translationY)),
    // The handle owns a new SPLIT pull independently of the native result list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      forwardResultsGesture,
      fullMap,
      fullMapProgress,
      fullMapPresentationOnUi,
      fullMapExpansionDistance,
      mapFullyCollapsed,
      reverseResultsGesture,
    ],
  );
  const collapsedMapStyle = useAnimatedStyle(() => ({
    height: fullMapPresentationOnUi.value
      ? fullMapProgress.value > 1
        ? fullMapHeight * (2 - fullMapProgress.value)
        : initialResultsMapHeight +
          (fullMapHeight - initialResultsMapHeight) * fullMapProgress.value
      : Math.max(0, initialResultsMapHeight * (1 - collapseProgress.value)),
    marginTop: fullMapPresentationOnUi.value
      ? fullMapProgress.value > 1
        ? spacing.sm * (2 - fullMapProgress.value)
        : spacing.sm
      : spacing.sm * (1 - collapseProgress.value),
    opacity: fullMapPresentationOnUi.value
      ? 1
      : collapseProgress.value <= 0.72
        ? 1 - collapseProgress.value * (0.28 / 0.72)
        : 0.72 * ((1 - collapseProgress.value) / 0.28),
  }));
  const fullMapSheetStyle = useAnimatedStyle(() => ({
    flex: fullMapPresentationOnUi.value ? 0 : 1,
    height: fullMapPresentationOnUi.value
      ? fullMapProgress.value > 1
        ? resultsCompositionHeight +
          (fullMapPeekHeight - resultsCompositionHeight) * (2 - fullMapProgress.value)
        : splitResultsHeight + (fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value
      : 0,
  }));
  const fullMapListViewportStyle = useAnimatedStyle(() => ({
    flex: fullMapPresentationOnUi.value ? 0 : 1,
    height: fullMapPresentationOnUi.value
      ? (fullMapProgress.value > 1
          ? Math.max(0, resultsCompositionHeight - fullMapHandleRegionHeight)
          : splitListViewportHeight) *
        (fullMapProgress.value > 1 ? fullMapProgress.value - 1 : 1 - fullMapProgress.value)
      : 0,
  }));
  const fullMapContentStyle = useAnimatedStyle(() => {
    const progress = fullMapVisualProgress(fullMapProgress.value);
    return {
      opacity: progress <= 0.6 ? 1 : progress >= 0.78 ? 0 : 1 - (progress - 0.6) / 0.18,
    };
  });
  const fullMapPeekStyle = useAnimatedStyle(() => {
    const progress = fullMapVisualProgress(fullMapProgress.value);
    return {
      height: fullMapPeekBodyHeight * progress,
      opacity: progress <= 0.78 ? 0 : progress >= 0.9 ? 1 : (progress - 0.78) / 0.12,
    };
  });
  const collapseHandleStyle = useAnimatedStyle(() => ({
    opacity: 1 - collapseProgress.value,
  }));
  const detailPresentationActive = mode === 'detail' || mode === 'quote';
  useEffect(() => {
    onTabBarHiddenChange?.(
      isFocused && ((mode === 'results' && fullMap) || detailPresentationActive),
    );
  }, [detailPresentationActive, fullMap, isFocused, mode, onTabBarHiddenChange]);
  useEffect(() => () => onTabBarHiddenChange?.(false), [onTabBarHiddenChange]);
  useEffect(() => {
    if (!fullMap || !listSearch.isError || !mapSearch.isError) return;
    const timer = setTimeout(settleFullMapExit, 0);
    return () => clearTimeout(timer);
    // The exit settlement is intentionally shared with gesture, tap, and accessibility exits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMap, fullMapProgress, listSearch.isError, mapSearch.isError]);
  const exploreScrollRef = useRef<ScrollView>(null);
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
    onSuccess: (_, { id, active }) => {
      setRailFavoriteOverrides((current) => ({ ...current, [id]: !active }));
      void client.invalidateQueries({ queryKey: ['favorites'] });
      void client.invalidateQueries({ queryKey: ['public-search'] });
      void client.invalidateQueries({ queryKey: ['public-vehicle'] });
      void client.invalidateQueries({ queryKey: ['renter-history', 'vehicles'] });
      void client.invalidateQueries({ queryKey: ['renter-recommendations', 'saved-similar'] });
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
    if (mode === 'detail' || mode === 'quote') {
      reserve.reset();
      void invalidateRenterVerification(client);
      return;
    }
    if (mode === 'results') {
      void listSearch.refetch();
      void mapSearch.refetch();
    } else if (home) {
      if (tripRailEligible) void listSearch.refetch();
      void areaRailSearch.refetch();
      void electricRailSearch.refetch();
      if (authenticatedRenter) {
        void recentSearchHistory.refetch();
        void recentVehicleHistory.refetch();
      }
    }
  });

  function openVehicle(id: string) {
    quote.reset();
    reserve.reset();
    continueBooking.reset();
    const index = sessionRecentlyViewed.indexOf(id);
    if (index >= 0) sessionRecentlyViewed.splice(index, 1);
    sessionRecentlyViewed.unshift(id);
    sessionRecentlyViewed.splice(10);
    detailOrigin.current =
      mode === 'favorites' ? 'favorites' : mode === 'results' ? 'results' : 'form';
    setVehicleId(id);
    setMode('detail');
  }

  function openContinuedResults() {
    if (!continuedSearch?.start || !continuedSearch.end) return;
    setPlace(continuedSearch.location);
    setActivePlace(continuedSearch.location);
    setRadiusKm(continuedSearch.radiusKm);
    setActiveRadiusKm(continuedSearch.radiusKm);
    setPickup(continuedSearch.start);
    setReturnAt(continuedSearch.end);
    setTripDatesEstablished(true);
    setExactTimesSelected(true);
    setDiscoveryLocationEstablished(true);
    setCategoryId(continuedSearch.categoryId);
    setMake(continuedSearch.make);
    setSeats(continuedSearch.seats);
    setTransmission(continuedSearch.transmission);
    setPowertrain(continuedSearch.powertrain);
    setMinPrice(continuedSearch.minPrice);
    setMaxPrice(continuedSearch.maxPrice);
    setHandover(continuedSearch.handover);
    setReturnHandover(continuedSearch.returnHandover);
    setExploreShortcut('CUSTOM');
    resetResultsViewport();
    setMode('results');
  }
  function performSearch(draft?: SearchDraft) {
    const nextPlace = draft?.place ?? place;
    const nextStart = draft?.start ?? pickup;
    const nextEnd = draft?.end ?? returnAt;
    if (nextEnd.getTime() <= nextStart.getTime()) return;
    const datesExplicit = draft?.datesExplicit ?? (tripDatesEstablished || exactTimesSelected);
    if (user?.roles.includes('RENTER')) {
      void apiClient
        .request('/me/discovery-history/searches', {
          body: JSON.stringify(
            committedSearchPayload({
              location: nextPlace,
              radiusKm,
              datesExplicit,
              start: nextStart,
              end: nextEnd,
              categoryId,
              make,
              seats,
              transmission,
              powertrain,
              minPrice,
              maxPrice,
              handover,
              returnHandover,
            }),
          ),
          method: 'POST',
        })
        .catch(() => undefined);
    }
    Keyboard.dismiss();
    setPlace(nextPlace);
    setActivePlace(nextPlace);
    setPickup(nextStart);
    setReturnAt(nextEnd);
    setActiveRadiusKm(radiusKm);
    setDiscoveryLocationEstablished(true);
    setTripDatesEstablished(datesExplicit);
    resetResultsViewport();
    setMode('results');
  }
  function searchMapArea(area: MapSearchArea) {
    setActivePlace((current) => ({
      ...current,
      source: undefined,
      latitude: area.latitude,
      longitude: area.longitude,
    }));
    setRadiusKm(area.radiusKm);
    setActiveRadiusKm(area.radiusKm);
    resetResultsViewport({ preserveFullMap: fullMap });
  }
  async function resolveCurrentLocation(): Promise<SearchLocation | null> {
    setLocationError('');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocationError('Location access was not granted. Choose a city instead.');
      return null;
    }
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const currentArea = {
        label: 'Current area',
        detail: 'Based on your device location',
        city: 'Current area',
        province: '',
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        source: 'DEVICE' as const,
      };
      return currentArea;
    } catch {
      setLocationError('We could not get your location. Choose a city instead.');
      return null;
    }
  }

  async function selectCurrentLocation(activateSearch = false): Promise<boolean> {
    const currentArea = await resolveCurrentLocation();
    if (!currentArea) return false;
    setPlace(currentArea);
    if (activateSearch) {
      setActivePlace(currentArea);
      setDiscoveryLocationEstablished(true);
    }
    return true;
  }

  function openExploreSearch() {
    setLocationOpen(true);
  }

  function selectExploreShortcut(shortcut: ExploreShortcut) {
    setExploreShortcut(shortcut);
    setCategoryId('');
    setPowertrain('');
    setSeats('');
    if (shortcut.startsWith('CATEGORY:')) setCategoryId(shortcut.slice('CATEGORY:'.length));
    if (shortcut === 'EV') setPowertrain('BATTERY_ELECTRIC');
    if (shortcut === 'SEVEN_PLUS') setSeats('7');
    if (shortcut === 'NEARBY') void selectCurrentLocation(true);
  }

  function prepareResultsFilterChange() {
    resetResultsViewport();
  }

  function resetResultsViewport({ preserveFullMap = false } = {}) {
    resultScrollOffset.current = 0;
    observedListOffset.value = 0;
    collapseProgress.value = 0;
    mapButtonShownOnUi.value = false;
    topReachedTravel.value = -1;
    reverseRestorationActive.value = false;
    resultListRef.current?.scrollToOffset({ animated: false, offset: 0 });
    mapFullyCollapsedRef.current = false;
    setMapFullyCollapsed(false);
    mapTransientUiDismissedRef.current = false;
    setSelectedMapVehicleId(null);
    mapButtonVisibleRef.current = false;
    mapRestoreInProgress.current = false;
    setMapButtonVisible(false);
    if (!preserveFullMap) {
      cancelAnimation(fullMapProgress);
      fullMapProgress.value = 0;
      fullMapPresentationOnUi.value = false;
      setFullMap(false);
    }
  }

  function commitMapRestoreToFullMap() {
    commitForwardPresentation(false, 0);
    setFullMap(true);
    setCollapseMapButtonVisible(false);
  }

  function finishMapRestoreToFullMap() {
    mapRestoreInProgress.current = false;
  }

  function restoreResultsMap() {
    if (mapRestoreInProgress.current) return;
    mapRestoreInProgress.current = true;
    resultListRef.current?.scrollToOffset({ animated: true, offset: 0 });
    observedListOffset.value = 0;
    topReachedTravel.value = -1;
    reverseRestorationActive.value = false;
    collapseProgress.value = 0;
    fullMapProgress.value = 2;
    fullMapPresentationOnUi.value = true;
    runOnJS(commitMapRestoreToFullMap)();
    fullMapProgress.value = withTiming(1, { duration: 260 }, (finished) => {
      if (!finished) return;
      runOnJS(finishMapRestoreToFullMap)();
    });
    mapButtonShownOnUi.value = false;
  }

  function settleFullMap(target: 0 | 1, onComplete?: () => void) {
    cancelAnimation(fullMapProgress);
    fullMapProgress.value = withTiming(target, { duration: 180 }, (finished) => {
      if (finished && onComplete) runOnJS(onComplete)();
    });
  }

  function commitFullMapExit() {
    observedListOffset.value = 0;
    resultScrollOffset.current = 0;
    collapseProgress.value = 0;
    mapFullyCollapsedRef.current = false;
    setMapFullyCollapsed(false);
    mapButtonShownOnUi.value = false;
    setCollapseMapButtonVisible(false);
    resultListRef.current?.scrollToOffset({ animated: false, offset: 0 });
    setFullMap(false);
    fullMapPresentationOnUi.value = false;
  }

  function settleFullMapExit() {
    settleFullMap(0, commitFullMapExit);
  }

  function beginFullMapGesture() {
    if (
      fullMap ||
      mapFullyCollapsedRef.current ||
      resultScrollOffset.current > 0 ||
      collapseProgress.value > 0
    ) {
      fullMapPresentationOnUi.value = false;
      return;
    }
    fullMapGestureStartY.current = 0;
    fullMapGestureDistance.current = 0;
  }

  function finishFullMapEntryGesture(translationY: number) {
    if (fullMapGestureStartY.current == null) return;
    fullMapGestureStartY.current = null;
    fullMapGestureDistance.current = Math.max(0, translationY);
    if (
      fullMapGestureDistance.current >= fullMapGestureThreshold &&
      !(listSearch.isError && mapSearch.isError)
    ) {
      setFullMap(true);
      settleFullMap(1);
    } else
      settleFullMap(0, () => {
        fullMapPresentationOnUi.value = false;
      });
    fullMapGestureDistance.current = 0;
  }

  function beginFullMapExitGesture(pageY: number) {
    if (!fullMap) return;
    cancelAnimation(fullMapProgress);
    fullMapGestureStartY.current = pageY;
    fullMapGestureDistance.current = 0;
  }

  function updateFullMapExitGesture(pageY: number) {
    if (!fullMap || fullMapGestureStartY.current == null) return;
    const distance = Math.max(0, fullMapGestureStartY.current - pageY);
    fullMapGestureDistance.current = distance;
    const progress = Math.max(0, 1 - distance / fullMapGestureThreshold);
    fullMapProgress.value = progress;
  }

  function finishFullMapExitGesture(force = false) {
    if (!force && fullMapGestureStartY.current == null) return;
    fullMapGestureStartY.current = null;
    if (
      force ||
      fullMapGestureDistance.current < 6 ||
      fullMapGestureDistance.current >= fullMapGestureThreshold
    )
      settleFullMapExit();
    else settleFullMap(1);
    fullMapGestureDistance.current = 0;
  }

  function syncExploreShortcut(nextCategory: string, nextPowertrain: string, nextSeats: string) {
    const category = categoryShortcuts.find(({ id }) => id === nextCategory);
    if (category) setExploreShortcut(`CATEGORY:${category.id}`);
    else if (nextPowertrain === 'BATTERY_ELECTRIC') setExploreShortcut('EV');
    else if (nextSeats === '7') setExploreShortcut('SEVEN_PLUS');
    else setExploreShortcut('ALL');
  }

  function toggleResultsCategory(id: string) {
    const nextCategory = categoryId === id ? '' : id;
    prepareResultsFilterChange();
    setCategoryId(nextCategory);
    syncExploreShortcut(nextCategory, powertrain, seats);
  }

  function toggleResultsPowertrain() {
    const nextPowertrain = powertrain === 'BATTERY_ELECTRIC' ? '' : 'BATTERY_ELECTRIC';
    prepareResultsFilterChange();
    setPowertrain(nextPowertrain);
    syncExploreShortcut(categoryId, nextPowertrain, seats);
  }

  function toggleResultsSeats() {
    const nextSeats = seats === '7' ? '' : '7';
    prepareResultsFilterChange();
    setSeats(nextSeats);
    syncExploreShortcut(categoryId, powertrain, nextSeats);
  }

  function toggleResultsDelivery() {
    prepareResultsFilterChange();
    setHandover(deliveryFilterActive ? 'ANY' : 'DELIVERY_AVAILABLE');
  }

  const committedFilters: DiscoveryFilters = {
    radiusKm: activeRadiusKm,
    make,
    categoryId,
    seats,
    transmission,
    powertrain,
    minPrice,
    maxPrice,
    handover,
    returnHandover,
  };

  function applyFilters(next: DiscoveryFilters) {
    const changed = !discoveryFiltersEqual(committedFilters, next);
    if (changed) prepareResultsFilterChange();
    setRadiusKm(next.radiusKm);
    setActiveRadiusKm(next.radiusKm);
    setMake(next.make);
    setCategoryId(next.categoryId);
    setSeats(next.seats);
    setTransmission(next.transmission);
    setPowertrain(next.powertrain);
    setMinPrice(next.minPrice);
    setMaxPrice(next.maxPrice);
    setHandover(next.handover);
    setReturnHandover(next.returnHandover);
    syncExploreShortcut(next.categoryId, next.powertrain, next.seats);
    if (home) setExploreShortcut('CUSTOM');
    setFiltersOpen(false);
  }

  const searchEditor = (
    <LocationSheet
      appliedEnd={returnAt}
      appliedStart={pickup}
      datesEstablished={tripDatesEstablished}
      error={locationError}
      locationEstablished={discoveryLocationEstablished}
      onClose={() => setLocationOpen(false)}
      onClearError={() => setLocationError('')}
      onCurrent={resolveCurrentLocation}
      onSearch={(draft) => {
        setLocationOpen(false);
        performSearch(draft);
      }}
      open={locationOpen}
      selected={discoveryLocationEstablished ? activePlace : place}
    />
  );

  if (mode === 'favorites')
    return (
      <FavoritesView
        data={favorites.data}
        error={favorites.error}
        loading={favorites.isPending}
        onBack={onExit ?? (() => setMode('form'))}
        onOpen={openVehicle}
        onRemove={(id) => favorite.mutate({ id, active: true })}
        onRetry={() => void favorites.refetch()}
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
        datesExplicit={tripDatesEstablished || exactTimesSelected}
        setPickup={(value) => {
          setPickup(value);
          setExactTimesSelected(true);
        }}
        setReturnAt={(value) => {
          setReturnAt(value);
          setExactTimesSelected(true);
        }}
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
  if (mode === 'results') {
    const resultSummary = formatResultSummary({
      hasNextPage: listSearch.hasNextPage === true,
      initialError: listSearch.isError && !listSearch.data,
      initialLoading: listSearch.isPending && !listSearch.data,
      loadedCount: uniqueVehicleCount(searchItems),
    });
    return (
      <Screen scroll={false}>
        <View style={styles.resultsHeader}>
          <Pressable
            accessibilityLabel="Back to Explore"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setMode('form')}
            style={styles.resultsHeaderButton}
          >
            <Icon color={colors.primary} name="arrow-back" size={21} />
          </Pressable>
          <Pressable
            accessibilityHint="Edit search"
            accessibilityLabel={`${activePlace.label}, ${tripDateSummary(pickup, returnAt)}`}
            accessibilityRole="button"
            onPress={() => setLocationOpen(true)}
            style={styles.resultsSearchSummary}
          >
            <Icon color={colors.primary} name="search" size={18} />
            <View style={styles.resultsSearchTextColumn}>
              <Text numberOfLines={1} style={styles.resultSearchLocation}>
                {activePlace.label}
              </Text>
              <Text numberOfLines={1} style={styles.resultsSearchDate}>
                {tripDateSummary(pickup, returnAt)}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={
              resultsFilterCount > 0
                ? `Filters, ${resultsFilterCount} active`
                : 'Filters, none active'
            }
            accessibilityRole="button"
            onPress={() => setFiltersOpen(true)}
            style={[
              styles.resultsHeaderButton,
              resultsFilterCount > 0 && styles.resultsHeaderButtonActive,
            ]}
          >
            <Icon color={colors.primary} name="options-outline" size={21} />
            {resultsFilterCount > 0 ? (
              <Text style={styles.filterCount}>{resultsFilterCount}</Text>
            ) : null}
          </Pressable>
        </View>
        <ScrollView
          accessibilityLabel="Search result quick filters"
          horizontal
          contentContainerStyle={styles.resultsQuickFilters}
          showsHorizontalScrollIndicator={false}
          style={styles.resultsQuickFilterScroller}
        >
          <Chip
            accessibilityLabel={`Delivery filter, ${deliveryFilterActive ? 'selected' : 'not selected'}`}
            label="Delivery"
            onPress={toggleResultsDelivery}
            selected={deliveryFilterActive}
          />
          {categoryShortcuts.map((category) => (
            <Chip
              accessibilityLabel={`${category.label} category filter, ${categoryId === category.id ? 'selected' : 'not selected'}`}
              key={category.id}
              label={category.label}
              onPress={() => toggleResultsCategory(category.id)}
              selected={categoryId === category.id}
            />
          ))}
          <Chip
            accessibilityLabel={`Electric vehicle filter, ${powertrain === 'BATTERY_ELECTRIC' ? 'selected' : 'not selected'}`}
            label="EV"
            onPress={toggleResultsPowertrain}
            selected={powertrain === 'BATTERY_ELECTRIC'}
          />
          <Chip
            accessibilityLabel={`Seven or more seats filter, ${seats === '7' ? 'selected' : 'not selected'}`}
            label="7+ seats"
            onPress={toggleResultsSeats}
            selected={seats === '7'}
          />
          <Chip
            accessibilityLabel={`Price filter, ${minPrice || maxPrice ? 'selected' : 'not selected'}`}
            label="Price"
            onPress={() => setFiltersOpen(true)}
            selected={Boolean(minPrice || maxPrice)}
          />
        </ScrollView>
        <View
          onLayout={({ nativeEvent }) => setResultsCompositionHeight(nativeEvent.layout.height)}
          style={styles.resultsComposition}
        >
          <Reanimated.View
            accessibilityLabel="Approximate vehicle map region"
            accessibilityElementsHidden={mapFullyCollapsed}
            importantForAccessibility={mapFullyCollapsed ? 'no-hide-descendants' : 'auto'}
            pointerEvents={mapFullyCollapsed ? 'none' : 'auto'}
            style={[styles.resultsMapClip, collapsedMapStyle]}
          >
            <View style={[styles.resultsMapContainer, styles.flex]}>
              <DiscoveryMap
                error={mapSearch.isError ? mapSearch.error : null}
                initialRegion={{
                  latitude: activePlace.latitude,
                  longitude: activePlace.longitude,
                  latitudeDelta: Math.max(0.03, activeRadiusKm / 55.5),
                  longitudeDelta: Math.max(0.03, activeRadiusKm / 55.5),
                }}
                items={mapItems}
                loading={mapSearch.isPending}
                onOpen={openVehicle}
                onRetry={() => void mapSearch.refetch()}
                onSearchArea={searchMapArea}
                onSelect={setSelectedMapVehicleId}
                recenterKey={`${place.latitude}:${place.longitude}`}
                selectedId={selectedMapVehicleId}
                transientUiDismissKey={mapTransientUiDismissKey}
              />
            </View>
          </Reanimated.View>
          <Reanimated.View
            accessible={fullMap}
            accessibilityHint={fullMap ? 'Activates vehicle results.' : undefined}
            accessibilityLabel={
              fullMap ? `${resultSummary}. Show vehicle results.` : 'Cars available results sheet'
            }
            accessibilityRole={fullMap ? 'button' : undefined}
            onAccessibilityTap={() => finishFullMapExitGesture(true)}
            onTouchEnd={() => {
              if (fullMap) finishFullMapExitGesture();
            }}
            onTouchMove={({ nativeEvent }) => updateFullMapExitGesture(nativeEvent.pageY)}
            onTouchStart={({ nativeEvent }) => {
              beginFullMapExitGesture(nativeEvent.pageY);
            }}
            style={[
              styles.resultsSheet,
              mapFullyCollapsed && styles.resultsSheetCollapsed,
              fullMapSheetStyle,
            ]}
          >
            <GestureDetector gesture={handleFullMapEntryGesture}>
              <Reanimated.View
                accessible={false}
                importantForAccessibility="no"
                style={[
                  styles.resultsSheetDragTarget,
                  mapFullyCollapsed && styles.resultsSheetDragTargetCollapsed,
                ]}
              >
                <Reanimated.View style={[styles.resultsSheetHandle, collapseHandleStyle]} />
              </Reanimated.View>
            </GestureDetector>
            <Reanimated.View
              accessibilityElementsHidden={!fullMap}
              importantForAccessibility={fullMap ? 'auto' : 'no-hide-descendants'}
              style={[styles.fullMapPeekBody, fullMapPeekStyle]}
            >
              <View style={styles.fullMapPeekSummaryArea}>
                <Text accessible={false} style={styles.fullMapPeekSummary}>
                  {resultSummary}
                </Text>
              </View>
              <View style={{ height: bottomSafeArea }} />
            </Reanimated.View>
            <GestureDetector gesture={resultsGesture}>
              <Reanimated.View
                accessibilityElementsHidden={fullMap}
                importantForAccessibility={fullMap ? 'no-hide-descendants' : 'auto'}
                pointerEvents={fullMap ? 'none' : 'auto'}
                style={[styles.fullMapListViewport, fullMapListViewportStyle]}
              >
                <Reanimated.View style={[styles.flex, fullMapContentStyle]}>
                  {listSearch.isPending ? (
                    <StateView
                      loading
                      title="Finding cars…"
                      message="Checking availability for your dates."
                    />
                  ) : listSearch.isError && !listSearch.data ? (
                    <StateView
                      icon="cloud-offline-outline"
                      title="Search unavailable"
                      message={listSearch.error.message}
                      actionLabel="Retry"
                      onAction={() => void listSearch.refetch()}
                    />
                  ) : (
                    <GestureDetector gesture={nativeResultListGesture}>
                      <Reanimated.FlatList
                        accessibilityLabel="Cars available vehicle list"
                        bounces={false}
                        contentInsetAdjustmentBehavior="never"
                        ref={resultListRef}
                        style={styles.flex}
                        data={searchItems}
                        keyExtractor={(item) => item.vehicleId}
                        ListHeaderComponent={
                          <NormalResultsSummary
                            compact={mapFullyCollapsed}
                            summary={resultSummary}
                          />
                        }
                        contentContainerStyle={[
                          styles.resultList,
                          { paddingBottom: Math.max(100, bottomSafeArea + 88) },
                        ]}
                        onContentSizeChange={(_width, height) => {
                          listContentHeight.value = height;
                          if (resultScrollOffset.current > 0)
                            resultListRef.current?.scrollToOffset({
                              animated: false,
                              offset: resultScrollOffset.current,
                            });
                        }}
                        onLayout={({ nativeEvent }) => {
                          listViewportHeight.value = nativeEvent.layout.height;
                        }}
                        onEndReached={() => {
                          if (listSearch.hasNextPage && !listSearch.isFetchingNextPage)
                            void listSearch.fetchNextPage();
                        }}
                        onEndReachedThreshold={0.25}
                        onMomentumScrollEnd={() => {
                          mapRestoreInProgress.current = false;
                        }}
                        onScroll={onResultsScroll}
                        onScrollBeginDrag={() => {
                          mapRestoreInProgress.current = false;
                        }}
                        scrollEventThrottle={16}
                        renderItem={({ item }) => (
                          <SearchResultVehicleCard
                            vehicle={item}
                            onOpen={() => openVehicle(item.vehicleId)}
                            onFavorite={() =>
                              favorite.mutate({ id: item.vehicleId, active: item.favorite })
                            }
                          />
                        )}
                        ListEmptyComponent={
                          <StateView
                            icon="search-outline"
                            title="Adjust your search"
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
                          listSearch.isFetchingNextPage ? (
                            <StateView loading title="Loading more cars…" />
                          ) : nextPageError ? (
                            <StateView
                              icon="cloud-offline-outline"
                              title="Couldn’t load more cars"
                              message={nextPageError.message}
                              actionLabel="Retry"
                              onAction={() => void fetchNextSearchPage()}
                            />
                          ) : searchItems.length > 0 && !listSearch.hasNextPage ? (
                            <Text style={styles.endOfResults}>
                              You’ve reached the end of these results.
                            </Text>
                          ) : null
                        }
                      />
                    </GestureDetector>
                  )}
                </Reanimated.View>
              </Reanimated.View>
            </GestureDetector>
          </Reanimated.View>
          {mapButtonVisible &&
          !fullMap &&
          !locationOpen &&
          !filtersOpen &&
          !(listSearch.isError && mapSearch.isError) &&
          (searchItems.length > 0 || listSearch.isError) ? (
            <View
              pointerEvents="box-none"
              style={[styles.mapRestoreLayer, { bottom: mapRestoreBottom }]}
            >
              <Pressable
                accessibilityHint="Scrolls results to reveal the map."
                accessibilityLabel="Show map"
                accessibilityRole="button"
                hitSlop={8}
                onPress={restoreResultsMap}
                style={({ pressed }) => [
                  styles.mapRestoreButton,
                  pressed && styles.mapRestoreButtonPressed,
                ]}
              >
                <Text maxFontSizeMultiplier={1.4} style={styles.mapRestoreLabel}>
                  Map
                </Text>
                <Icon color={colors.onPrimary} name="map-outline" size={18} />
              </Pressable>
            </View>
          ) : null}
        </View>
        {searchEditor}
        {filtersOpen && (
          <FilterSheet
            committed={committedFilters}
            priceRange={listSearch.data?.pages[0]?.facets?.pricePerDay}
            referenceData={reference.data}
            filtersOpen={filtersOpen}
            onApply={applyFilters}
            onClose={() => setFiltersOpen(false)}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      {...(home ? { scrollRef: exploreScrollRef } : {})}
      eyebrow={home ? undefined : 'Find a car'}
      title={home ? undefined : 'Search cars'}
      subtitle={home ? undefined : 'Book verified cars from local owners across the Philippines.'}
      action={
        home ? undefined : (
          <IconButton
            icon="heart-outline"
            label="Open Wishlist"
            onPress={() => setMode('favorites')}
          />
        )
      }
    >
      {home && (
        <Pressable
          accessibilityLabel="Start your search"
          accessibilityRole="button"
          onPress={openExploreSearch}
          style={({ pressed }) => [styles.exploreSearchPill, pressed && styles.explorePressed]}
        >
          <View style={styles.exploreSearchIcon}>
            <Icon color={colors.primary} name="search" size={22} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.exploreSearchTitle}>
              {discoveryLocationEstablished ? activePlace.label : 'Start your search'}
            </Text>
            <Text numberOfLines={1} style={styles.exploreSearchSummary}>
              {discoveryLocationEstablished
                ? tripDatesEstablished
                  ? tripDateSummary(pickup, returnAt)
                  : 'Add trip dates'
                : 'Search destinations, cities or places'}
            </Text>
          </View>
          <Icon color={colors.subtleText} name="chevron-forward" size={19} />
        </Pressable>
      )}
      {home && pendingRecoveryActions.length > 0 && (
        <Pressable
          ref={recoveryAlertRef}
          accessibilityHint="Opens required handover actions"
          accessibilityLabel={recoveryActionCountLabel(pendingRecoveryActions.length)}
          accessibilityRole="button"
          onPress={() => setRecoveryActionsOpen(true)}
          style={({ pressed }) => [styles.recoveryAlert, pressed && styles.explorePressed]}
        >
          <Icon color={colors.warning} name="warning-outline" size={18} />
          <Text style={styles.recoveryAlertText}>
            {recoveryActionCountLabel(pendingRecoveryActions.length)}
          </Text>
          <Icon color={colors.warning} name="chevron-forward" size={18} />
        </Pressable>
      )}
      {home && (
        <Modal
          animationType="slide"
          onRequestClose={closeRecoveryActions}
          onShow={() => {
            const target = findNodeHandle(recoveryTitleRef.current);
            if (target) AccessibilityInfo.setAccessibilityFocus(target);
          }}
          transparent
          visible={recoveryActionsOpen && pendingRecoveryActions.length > 0}
        >
          <View style={styles.recoveryModalBackdrop}>
            <View accessibilityViewIsModal style={styles.recoveryModalSheet}>
              <ScrollView
                contentContainerStyle={[
                  styles.recoveryModalContent,
                  { paddingBottom: Math.max(spacing.lg, bottomSafeArea + spacing.sm) },
                ]}
              >
                <Text
                  ref={recoveryTitleRef}
                  accessibilityRole="header"
                  style={styles.recoveryTitle}
                >
                  Action required
                </Text>
                <Text style={styles.recoverySubtitle}>
                  {recoveryActionCountLabel(pendingRecoveryActions.length)}
                </Text>
                {pendingRecoveryActions.map((action) => (
                  <View key={action.key} style={styles.recoveryAction}>
                    <View style={styles.recoveryActionCopy}>
                      <Text style={styles.recoveryActionTitle}>
                        {recoveryActionScopeLabel(action.scope)}
                      </Text>
                      <Text style={styles.recoveryDeadline}>
                        {new Date(action.responseDeadlineAt).getTime() <= recoveryClock
                          ? 'Response overdue'
                          : 'Response due'}
                        : {dateTimeLabel(action.responseDeadlineAt)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`Review ${recoveryActionScopeLabel(action.scope)} for booking ${action.reference}`}
                      accessibilityRole="button"
                      onPress={() => {
                        setRecoveryActionsOpen(false);
                        navigation.navigate('BookingRecovery', { bookingId: action.reference });
                      }}
                      style={styles.recoveryReview}
                    >
                      <Text style={styles.recoveryReviewText}>Review</Text>
                      <Icon color={colors.primary} name="chevron-forward" size={16} />
                    </Pressable>
                  </View>
                ))}
                <Button compact label="Not now" onPress={closeRecoveryActions} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
      {!home && (
        <View>
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
            <Pressable
              accessibilityLabel={`Trip dates, ${tripDateSummary(pickup, returnAt)}. Change dates`}
              accessibilityRole="button"
              onPress={() => setLocationOpen(true)}
              style={styles.searchCollapsedCard}
            >
              <View>
                <Text style={styles.searchCollapsedLabel}>Trip dates</Text>
                <Text style={styles.searchCollapsedValue}>{tripDateSummary(pickup, returnAt)}</Text>
              </View>
              <Text style={styles.searchEdit}>Change</Text>
            </Pressable>
            {!validDates && <Text style={styles.error}>Return must be after pickup.</Text>}
            <Button
              disabled={!validDates}
              icon="search"
              label="Search cars"
              onPress={performSearch}
            />
          </Card>
        </View>
      )}
      {!home && (
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
                returnHandover: returnHandover === 'ANY' ? '' : returnHandover,
              })
                ? `${activeFilterCount({ make, categoryId, seats, transmission, powertrain, minPrice, maxPrice, handover: handover === 'ANY' ? '' : handover, returnHandover: returnHandover === 'ANY' ? '' : returnHandover })} filters`
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
      )}
      {home && (
        <>
          <ScrollView
            accessibilityLabel="Vehicle discovery categories"
            contentContainerStyle={styles.exploreCategoryContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.exploreCategoryRow}
          >
            <Chip
              compact
              label="All"
              selected={exploreShortcut === 'ALL'}
              onPress={() => selectExploreShortcut('ALL')}
            />
            <Chip
              compact
              icon="navigate-outline"
              label="Nearby"
              selected={exploreShortcut === 'NEARBY'}
              onPress={() => selectExploreShortcut('NEARBY')}
            />
            {categoryShortcuts.map((category) => {
              const shortcut = `CATEGORY:${category.id}` as const;
              return (
                <Chip
                  compact
                  key={category.id}
                  label={category.label}
                  selected={exploreShortcut === shortcut}
                  onPress={() => selectExploreShortcut(shortcut)}
                />
              );
            })}
            <Chip
              compact
              icon="flash-outline"
              label="EV"
              selected={exploreShortcut === 'EV'}
              onPress={() => selectExploreShortcut('EV')}
            />
            <Chip
              compact
              icon="people-outline"
              label="7+ seats"
              selected={exploreShortcut === 'SEVEN_PLUS'}
              onPress={() => selectExploreShortcut('SEVEN_PLUS')}
            />
          </ScrollView>
          {locationError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {locationError}
            </Text>
          ) : null}
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={recentRailItems}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            title="Recently viewed"
          />
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={continuedRailItems}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            onSeeAll={
              continuedSearch?.start && continuedSearch.end ? openContinuedResults : undefined
            }
            title={continuedSearch?.title ?? 'Continue exploring'}
          />
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={savedSimilarityRailItems.length >= 2 ? savedSimilarityRailItems : []}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            title="More like cars you've saved"
          />
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={areaRailItems}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            title={areaRailTitle(discoveryLocationEstablished, activePlace)}
          />
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={electricRailItems}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            title="Electric cars"
          />
          <ExploreVehicleSection
            cardWidth={Math.min(320, Math.max(250, viewportWidth - 72))}
            items={tripRailItems}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            onSeeAll={() => {
              resetResultsViewport();
              setMode('results');
            }}
            subtitle="Availability is rechecked before booking."
            title="Available for your trip"
          />
        </>
      )}
      {searchEditor}
      {filtersOpen ? (
        <FilterSheet
          committed={committedFilters}
          priceRange={listSearch.data?.pages[0]?.facets?.pricePerDay}
          referenceData={reference.data}
          filtersOpen={filtersOpen}
          onApply={applyFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

function NormalResultsSummary({
  compact = false,
  summary,
}: {
  readonly compact?: boolean;
  readonly summary: string;
}) {
  return (
    <View style={[styles.normalResultsSummary, compact && styles.normalResultsSummaryCompact]}>
      <Text accessibilityRole="header" style={styles.resultsHeading}>
        {summary}
      </Text>
    </View>
  );
}

function SearchResultVehicleCard({
  vehicle,
  onOpen,
  onFavorite,
}: {
  readonly vehicle: VehicleCardView;
  readonly onOpen: () => void;
  readonly onFavorite: () => void;
}) {
  const identity = `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();
  const location = [vehicle.approximateLocation.city, vehicle.approximateLocation.province]
    .filter(Boolean)
    .join(', ');
  const hasRating = Boolean(vehicle.rating?.averageRating && vehicle.rating.reviewCount > 0);
  const visibleRating = hasRating
    ? `${vehicle.rating!.averageRating} (${vehicle.rating!.reviewCount})`
    : 'New';
  const ratingAccessibility = hasRating
    ? `Rated ${vehicle.rating!.averageRating} out of 5 from ${vehicle.rating!.reviewCount} reviews`
    : 'New, no reviews yet';
  const attributes = [
    typeof vehicle.seats === 'number' ? `${vehicle.seats} seats` : null,
    vehicle.transmission ? domainLabel(vehicle.transmission) : null,
    vehicle.category?.name,
  ].filter((value): value is string => Boolean(value));
  const fulfillmentLabel =
    vehicle.fulfillment.deliveryToSearchLocation === true
      ? 'Delivery to your location'
      : vehicle.fulfillment.ownerDeliveryAvailable
        ? 'Delivery available'
        : vehicle.fulfillment.renterPickupAvailable
          ? 'Pickup available'
          : null;
  const accessibilityLabel = [
    identity,
    location,
    `about ${vehicle.distanceKm.toFixed(1)} kilometers away`,
    ratingAccessibility,
    attributes.join(', '),
    `${money(vehicle.displayPrice.amountMinor, vehicle.currency)} per day`,
    fulfillmentLabel,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={styles.vehicleCard}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.vehicleCardOpen, pressed && styles.vehicleCardPressed]}
      >
        <View style={styles.vehicleImageFrame}>
          <VehicleImage
            accessible={false}
            contentPath={vehicle.coverPhoto?.contentPath}
            style={styles.cardImage}
          />
        </View>
        <View style={styles.vehicleContent}>
          <Text numberOfLines={2} style={styles.vehicleTitle}>
            {identity || 'Vehicle'}
          </Text>
          <View style={styles.vehicleLocationRatingRow}>
            <Text numberOfLines={1} style={styles.vehicleLocation}>
              {location} · about {vehicle.distanceKm.toFixed(1)} km away
            </Text>
            <Text accessibilityLabel={ratingAccessibility} style={styles.vehicleRating}>
              ★ {visibleRating}
            </Text>
          </View>
          {attributes.length > 0 ? (
            <Text numberOfLines={2} style={styles.vehicleAttributes}>
              {attributes.slice(0, 3).join(' · ')}
            </Text>
          ) : null}
          <View style={styles.vehiclePriceFulfillmentRow}>
            <Text numberOfLines={1} style={styles.vehiclePrice}>
              {money(vehicle.displayPrice.amountMinor, vehicle.currency)}{' '}
              <Text style={styles.vehiclePriceUnit}>/ day</Text>
            </Text>
            {fulfillmentLabel ? <StatusBadge label={fulfillmentLabel} /> : null}
          </View>
          {vehicle.fulfillment.deliveryToSearchLocationReason === 'INSUFFICIENT_NOTICE' &&
            typeof vehicle.fulfillment.fulfillmentMinimumNoticeMinutes === 'number' && (
              <Text style={styles.vehicleNotice}>
                Delivery requires {noticeLabel(vehicle.fulfillment.fulfillmentMinimumNoticeMinutes)}{' '}
                notice.
              </Text>
            )}
        </View>
      </Pressable>
      <View style={styles.favorite}>
        <IconButton
          active={vehicle.favorite}
          icon={vehicle.favorite ? 'heart' : 'heart-outline'}
          label={`${vehicle.favorite ? 'Remove' : 'Save'} ${identity || 'vehicle'} ${vehicle.favorite ? 'from' : 'to'} Wishlist`}
          onPress={onFavorite}
        />
      </View>
    </View>
  );
}

function ExploreVehicleSection({
  title,
  subtitle,
  items,
  cardWidth,
  onOpen,
  onFavorite,
  onSeeAll,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly ExploreRailCard[];
  readonly cardWidth: number;
  readonly onOpen: (vehicle: ExploreRailCard) => void;
  readonly onFavorite: (vehicle: ExploreRailCard) => void;
  readonly onSeeAll?: (() => void) | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <View accessibilityLabel={`${title} vehicle section`} style={styles.exploreSection}>
      <View style={styles.exploreSectionHeader}>
        <Text accessibilityRole="header" style={styles.exploreSectionTitle}>
          {title}
        </Text>
        {onSeeAll ? (
          <Pressable
            accessibilityLabel={`See all ${title}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onSeeAll}
          >
            <Icon color={colors.primary} name="chevron-forward" size={24} />
          </Pressable>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.exploreSectionSubtitle}>{subtitle}</Text> : null}
      <ScrollView
        accessibilityLabel={`${title} vehicles`}
        contentContainerStyle={styles.exploreRailContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.exploreRail}
      >
        {items.map((vehicle) => (
          <ExploreVehicleCard
            key={vehicle.vehicleId}
            cardWidth={cardWidth}
            vehicle={vehicle}
            onFavorite={() => onFavorite(vehicle)}
            onOpen={() => onOpen(vehicle)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ExploreVehicleCard({
  vehicle,
  cardWidth,
  onOpen,
  onFavorite,
}: {
  readonly vehicle: ExploreRailCard;
  readonly cardWidth: number;
  readonly onOpen: () => void;
  readonly onFavorite: () => void;
}) {
  const identity = `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim();
  const rating = vehicle.rating?.averageRating
    ? `Rated ${vehicle.rating.averageRating} from ${vehicle.rating.reviewCount} reviews`
    : 'New listing';
  return (
    <Pressable
      accessibilityLabel={`${identity}, ${rating}, ${money(vehicle.displayPrice.amountMinor, vehicle.currency)} per day, ${vehicle.approximateLocation.city}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.exploreVehicleCard,
        { width: cardWidth },
        pressed && styles.explorePressed,
      ]}
    >
      <View>
        <VehicleImage
          accessibilityLabel={`${identity} cover photo`}
          contentPath={vehicle.coverPhoto?.contentPath}
          style={styles.exploreVehicleImage}
        />
        <View style={styles.exploreFavorite}>
          <IconButton
            active={vehicle.favorite}
            icon={vehicle.favorite ? 'heart' : 'heart-outline'}
            label={
              vehicle.favorite ? `Remove ${identity} from Wishlist` : `Save ${identity} to Wishlist`
            }
            onPress={onFavorite}
          />
        </View>
      </View>
      <View style={styles.exploreVehicleBody}>
        <Text numberOfLines={1} style={styles.exploreVehicleTitle}>
          {identity}
        </Text>
        <Text numberOfLines={1} style={styles.exploreVehicleLocation}>
          {vehicle.approximateLocation.city}, {vehicle.approximateLocation.province}
        </Text>
        <View style={styles.exploreVehicleMeta}>
          <Text accessibilityLabel={rating} style={styles.exploreRating}>
            {vehicle.rating?.averageRating
              ? `★ ${vehicle.rating.averageRating}${vehicle.rating.reviewCount ? ` (${vehicle.rating.reviewCount})` : ''}`
              : 'New'}
          </Text>
          <Text accessibilityLabel="Server-projected daily price" style={styles.explorePrice}>
            {money(vehicle.displayPrice.amountMinor, vehicle.currency)} / day
          </Text>
        </View>
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
  readonly datesExplicit: boolean;
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
  const { bottom: bottomSafeArea, top: topSafeArea } = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const heroGalleryRef = useRef<FlatList<VehicleGalleryItem>>(null);
  const fullGalleryRef = useRef<FlatList<VehicleGalleryItem>>(null);
  const selectedGalleryIndex = useRef(0);
  const quotePosition = useRef(0);
  const lastScrolledQuoteId = useRef<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [quoteClock, setQuoteClock] = useState(() => Date.now());
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
  const [tripOpen, setTripOpen] = useState(false);
  const [tripCalendarOpen, setTripCalendarOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [draftPickup, setDraftPickup] = useState(properties.pickup);
  const [draftReturnAt, setDraftReturnAt] = useState(properties.returnAt);
  const [draftDatesExplicit, setDraftDatesExplicit] = useState(properties.datesExplicit);
  const [draftStartMethod, setDraftStartMethod] = useState(startMethod);
  const [draftEndMethod, setDraftEndMethod] = useState(endMethod);
  const [draftSameAsDelivery, setDraftSameAsDelivery] = useState(sameAsDelivery);
  const [draftDeliveryLocation, setDraftDeliveryLocation] = useState<CarShareLocation>();
  const [draftCollectionLocation, setDraftCollectionLocation] = useState<CarShareLocation>();
  const [picker, setPicker] = useState<'delivery' | 'collection' | null>(null);
  const quoteData = properties.quote.data;
  const hostSummary = useQuery({
    enabled: Boolean(vehicle?.owner.publicReference),
    queryKey: ['public-host', vehicle?.owner.publicReference],
    queryFn: () => apiClient.request<PublicHostSummary>(`/hosts/${vehicle!.owner.publicReference}`),
    staleTime: 30_000,
  });
  const reviewPreview = useQuery({
    enabled: Boolean(vehicle?.vehicleId && vehicle.rating?.reviewCount),
    queryKey: ['public-review-preview', vehicle?.vehicleId, 2],
    queryFn: () =>
      apiClient.request<PublicReviewPreview>(`/vehicles/${vehicle!.vehicleId}/reviews?limit=2`),
    staleTime: 30_000,
  });
  const detailScrollOffset = useSharedValue(0);
  const heroHeight = Math.round(Math.min(viewportWidth / (4 / 3), 480));
  const stickyHeaderHeight = topSafeArea + 48 + spacing.md;
  const stickyHeaderTransitionDistance = Math.max(1, heroHeight - stickyHeaderHeight);
  const onDetailScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      detailScrollOffset.value = Math.max(0, event.contentOffset.y);
    },
  });
  const stickyHeaderStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      detailScrollOffset.value,
      [0, stickyHeaderTransitionDistance],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      backgroundColor: interpolateColor(
        progress,
        [0, 1],
        ['rgba(255,255,255,0)', 'rgba(255,255,255,1)'],
      ),
      borderBottomColor: interpolateColor(
        progress,
        [0, 1],
        ['rgba(15,45,35,0)', 'rgba(15,45,35,0.12)'],
      ),
    };
  });

  useEffect(() => {
    const expiresAt = quoteData ? Date.parse(quoteData.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) return;
    const timer = setTimeout(
      () => setQuoteClock(Date.now()),
      Math.max(0, expiresAt - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [quoteData]);

  const selectGalleryPage = (index: number) => {
    selectedGalleryIndex.current = index;
    setGalleryIndex(index);
  };

  const closeGallery = () => {
    setGalleryOpen(false);
    requestAnimationFrame(() => {
      heroGalleryRef.current?.scrollToIndex({
        animated: false,
        index: selectedGalleryIndex.current,
      });
    });
  };
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
  const discountMessage = properties.datesExplicit
    ? durationDiscountMessage(selectedChargeableDays, durationDiscounts)
    : 'Longer-trip discounts available.';
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
  const galleryPhotos: readonly VehicleGalleryItem[] = vehicle.photos?.length
    ? vehicle.photos
    : [{ contentPath: '', expiresAt: '', id: 'fallback' }];
  const vehicleTitle = [vehicle.make, vehicle.model, vehicle.variant, vehicle.year]
    .filter(Boolean)
    .join(' ');
  const reviewTitle = `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim();
  const memberSinceYear = vehicle.owner.memberSince
    ? new Date(vehicle.owner.memberSince).getFullYear()
    : null;
  const openReviews = () =>
    navigation.navigate('PublicReviews', {
      path: `/vehicles/${vehicle.vehicleId}/reviews`,
      title: reviewTitle,
    });
  const keySpecifications = [
    {
      icon: 'car-outline' as const,
      label: 'Category',
      value: vehicle.category?.name ?? 'Vehicle',
    },
    {
      icon: 'people-outline' as const,
      label: 'Seats',
      value: vehicle.seats ? `${vehicle.seats} seats` : 'Seats not specified',
    },
    {
      icon: 'exit-outline' as const,
      label: 'Doors',
      value: vehicle.doors ? `${vehicle.doors} doors` : 'Doors not specified',
    },
    {
      icon: 'options-outline' as const,
      label: 'Transmission',
      value: domainLabel(vehicle.transmission),
    },
    {
      icon: 'flash-outline' as const,
      label: 'Powertrain',
      value: domainLabel(vehicle.powertrain ?? vehicle.fuelType),
    },
  ];
  const visibleFeatures = vehicle.features.slice(0, 6);
  const quoteExpiresAt = quoteData ? Date.parse(quoteData.expiresAt) : Number.NaN;
  const quoteExpired = Boolean(
    quoteData && Number.isFinite(quoteExpiresAt) && quoteExpiresAt <= quoteClock,
  );
  const verificationRequired =
    properties.reserve.isError &&
    properties.reserve.error instanceof ApiError &&
    properties.reserve.error.code === 'RENTER_VERIFICATION_REQUIRED';
  const reservationNeedsRefresh = properties.reserve.isError && !verificationRequired;
  const quoteNeedsRefresh = quoteExpired || properties.quote.isError || reservationNeedsRefresh;
  const validQuote = Boolean(quoteData && !quoteNeedsRefresh);
  const tripValid =
    properties.datesExplicit && properties.returnAt > properties.pickup && fulfillmentValid;
  const requestCurrentQuote = () => {
    properties.reserve.reset();
    properties.continueBooking.reset();
    properties.quote.mutate(fulfillmentInput());
  };
  const resetUnheldQuote = () => {
    if (properties.reserve.data) return;
    properties.quote.reset();
    properties.reserve.reset();
    properties.continueBooking.reset();
  };
  const openTripConfiguration = () => {
    setDraftPickup(properties.pickup);
    setDraftReturnAt(properties.returnAt);
    setDraftDatesExplicit(properties.datesExplicit);
    setDraftStartMethod(startMethod);
    setDraftEndMethod(endMethod);
    setDraftSameAsDelivery(sameAsDelivery);
    setDraftDeliveryLocation(deliveryLocation);
    setDraftCollectionLocation(collectionLocation);
    setTripCalendarOpen(false);
    setPicker(null);
    setTripOpen(true);
  };
  const closeTripConfiguration = () => {
    setPicker(null);
    setTripCalendarOpen(false);
    setTripOpen(false);
  };
  const draftFulfillmentValid =
    (draftStartMethod !== 'OWNER_DELIVERY' || Boolean(draftDeliveryLocation)) &&
    (draftEndMethod !== 'OWNER_COLLECTION' ||
      (draftStartMethod === 'OWNER_DELIVERY' && draftSameAsDelivery) ||
      Boolean(draftCollectionLocation));
  const draftTripValid = draftDatesExplicit && draftReturnAt > draftPickup && draftFulfillmentValid;
  const draftChargeableDays = chargeableDays(draftPickup, draftReturnAt);
  const draftDiscountMessage = draftDatesExplicit
    ? durationDiscountMessage(draftChargeableDays, durationDiscounts)
    : 'Longer-trip discounts available.';
  const saveTripConfiguration = () => {
    if (!draftTripValid) return;
    const criteriaChanged =
      draftPickup.getTime() !== properties.pickup.getTime() ||
      draftReturnAt.getTime() !== properties.returnAt.getTime() ||
      draftDatesExplicit !== properties.datesExplicit ||
      draftStartMethod !== startMethod ||
      draftEndMethod !== endMethod ||
      draftSameAsDelivery !== sameAsDelivery ||
      JSON.stringify(draftDeliveryLocation) !== JSON.stringify(deliveryLocation) ||
      JSON.stringify(draftCollectionLocation) !== JSON.stringify(collectionLocation);
    if (criteriaChanged || !properties.datesExplicit) resetUnheldQuote();
    properties.setPickup(draftPickup);
    properties.setReturnAt(draftReturnAt);
    setStartMethod(draftStartMethod);
    setEndMethod(draftEndMethod);
    setSameAsDelivery(draftSameAsDelivery);
    setDeliveryLocation(draftDeliveryLocation);
    setCollectionLocation(draftCollectionLocation);
    closeTripConfiguration();
  };
  const bookingBarAction = properties.reserve.data
    ? {
        disabled: properties.continueBooking.isPending,
        label: properties.continueBooking.isPending ? 'Securing payment…' : 'Authorize payment',
        onPress: () => properties.continueBooking.mutate(properties.reserve.data!.publicReference),
      }
    : properties.quote.isPending
      ? { disabled: true, label: 'Checking price…', onPress: requestCurrentQuote }
      : !properties.datesExplicit
        ? { disabled: false, label: 'Select trip', onPress: openTripConfiguration }
        : properties.reserve.isPending
          ? {
              disabled: true,
              label: 'Reserving…',
              onPress: () => undefined,
            }
          : validQuote && quoteData
            ? {
                disabled: false,
                label: 'Reserve car',
                onPress: () => properties.reserve.mutate(quoteData.id),
              }
            : {
                disabled: !tripValid,
                label: quoteNeedsRefresh ? 'Check current price' : 'Check price',
                onPress: requestCurrentQuote,
              };
  const bookingBarPrice =
    (validQuote || properties.reserve.isPending || properties.reserve.data) && quoteData
      ? {
          context: 'Authoritative quoted total',
          label: money(quoteData.totalMinor, quoteData.currency),
          suffix: 'total',
        }
      : {
          context: 'Advisory daily price',
          label: `From ${money(vehicle.pricing.dailyRateMinor, vehicle.pricing.currency)}`,
          suffix: 'per day',
        };
  const bookingBarTripContext = properties.datesExplicit
    ? tripDateSummary(properties.pickup, properties.returnAt)
    : 'Add dates';
  const bookingBar = (
    <View style={[styles.bookingBar, { paddingBottom: Math.max(bottomSafeArea, spacing.sm) }]}>
      <Pressable
        accessibilityLabel={`${bookingBarPrice.label} ${bookingBarPrice.suffix}. ${bookingBarTripContext}. Edit trip`}
        accessibilityRole="button"
        disabled={Boolean(properties.reserve.data)}
        onPress={openTripConfiguration}
        style={styles.bookingBarPrice}
      >
        <Text accessible={false} style={styles.bookingBarContext}>
          {bookingBarPrice.context}
        </Text>
        <Text accessible={false} numberOfLines={1} style={styles.bookingBarAmount}>
          {bookingBarPrice.label}
        </Text>
        <Text accessible={false} style={styles.bookingBarSuffix}>
          {bookingBarPrice.suffix} · {bookingBarTripContext}
        </Text>
      </Pressable>
      <View style={styles.bookingBarAction}>
        <Button
          disabled={bookingBarAction.disabled}
          label={bookingBarAction.label}
          onPress={bookingBarAction.onPress}
        />
      </View>
    </View>
  );
  const stickyGalleryHeader = (
    <View
      pointerEvents="box-none"
      style={[styles.detailStickyHeader, { height: stickyHeaderHeight }]}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[styles.detailStickyHeaderBackground, stickyHeaderStyle]}
      />
      <View
        pointerEvents="box-none"
        style={[styles.detailStickyControls, { top: topSafeArea + spacing.sm }]}
      >
        <View style={styles.detailGalleryControl}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={properties.onBack}
            style={styles.detailGalleryControlPressable}
          >
            <Icon color={colors.ink} name="arrow-back" size={24} />
          </Pressable>
        </View>
        <View style={styles.detailGalleryControl}>
          <Pressable
            accessibilityLabel={vehicle.favorite ? 'Remove from Wishlist' : 'Save to Wishlist'}
            accessibilityRole="button"
            accessibilityState={{ selected: vehicle.favorite }}
            hitSlop={8}
            onPress={properties.onFavorite}
            style={styles.detailGalleryControlPressable}
          >
            <Icon
              color={vehicle.favorite ? colors.primary : colors.ink}
              name={vehicle.favorite ? 'heart' : 'heart-outline'}
              size={24}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
  return (
    <Screen
      animatedScroll
      bottomAccessory={bookingBar}
      onScroll={onDetailScroll}
      overlay={stickyGalleryHeader}
      scrollRef={scrollRef}
      safeTop={false}
    >
      <View style={[styles.detailGalleryShell, { height: heroHeight }]}>
        <FlatList
          ref={heroGalleryRef}
          data={galleryPhotos}
          getItemLayout={(_, index) => ({
            index,
            length: viewportWidth,
            offset: viewportWidth * index,
          })}
          horizontal
          keyExtractor={(photo) => photo.id}
          onMomentumScrollEnd={(event) =>
            selectGalleryPage(Math.round(event.nativeEvent.contentOffset.x / viewportWidth))
          }
          pagingEnabled
          renderItem={({ item: photo, index }) => (
            <Pressable
              accessibilityHint="Opens this photo full screen"
              accessibilityLabel={`Vehicle photo ${index + 1} of ${galleryPhotos.length}`}
              accessibilityRole="button"
              onPress={() => {
                selectGalleryPage(index);
                setGalleryOpen(true);
              }}
            >
              <VehicleImage
                contentPath={photo.contentPath}
                style={{ height: heroHeight, width: viewportWidth }}
              />
            </Pressable>
          )}
          showsHorizontalScrollIndicator={false}
          style={styles.detailGallery}
        />
        <View pointerEvents="none" style={styles.detailGalleryIndicator}>
          <Text style={styles.galleryIndicatorText}>
            {galleryIndex + 1} / {galleryPhotos.length}
          </Text>
        </View>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={closeGallery}
        onShow={() =>
          fullGalleryRef.current?.scrollToIndex({
            animated: false,
            index: selectedGalleryIndex.current,
          })
        }
        statusBarTranslucent
        visible={galleryOpen}
      >
        <View style={styles.fullGallery}>
          <FlatList
            ref={fullGalleryRef}
            data={galleryPhotos}
            getItemLayout={(_, index) => ({
              index,
              length: viewportWidth,
              offset: viewportWidth * index,
            })}
            horizontal
            initialScrollIndex={galleryIndex}
            keyExtractor={(photo) => photo.id}
            onMomentumScrollEnd={(event) =>
              selectGalleryPage(Math.round(event.nativeEvent.contentOffset.x / viewportWidth))
            }
            pagingEnabled
            renderItem={({ item: photo, index }) => (
              <VehicleImage
                accessibilityLabel={`Vehicle photo ${index + 1} of ${galleryPhotos.length}`}
                contentPath={photo.contentPath}
                resizeMode="contain"
                style={{ height: '100%', width: viewportWidth }}
              />
            )}
            showsHorizontalScrollIndicator={false}
          />
          <Pressable
            accessibilityLabel="Close gallery"
            accessibilityRole="button"
            hitSlop={8}
            onPress={closeGallery}
            style={[styles.fullGalleryClose, { top: topSafeArea + spacing.sm }]}
          >
            <Icon color={colors.onPrimary} name="close" size={26} />
          </Pressable>
          <View pointerEvents="none" style={styles.fullGalleryIndicator}>
            <Text style={styles.galleryIndicatorText}>
              {galleryIndex + 1} / {galleryPhotos.length}
            </Text>
          </View>
        </View>
      </Modal>
      <View style={styles.detailHeroInformation}>
        <Text accessibilityRole="header" style={styles.detailTitle}>
          {vehicleTitle}
        </Text>
        <Pressable
          accessibilityHint={vehicle.rating?.reviewCount ? 'Opens vehicle reviews' : undefined}
          accessibilityLabel={
            vehicle.rating?.averageRating
              ? `${vehicle.rating.averageRating} out of 5, ${vehicle.rating.reviewCount} reviews`
              : 'New listing with no reviews'
          }
          accessibilityRole={vehicle.rating?.reviewCount ? 'button' : 'text'}
          disabled={!vehicle.rating?.reviewCount}
          onPress={openReviews}
          style={styles.detailRating}
        >
          <Icon color={colors.primary} name="star" size={17} />
          <Text style={styles.detailRatingText}>
            {vehicle.rating?.averageRating
              ? `${vehicle.rating.averageRating} · ${vehicle.rating.reviewCount} reviews`
              : 'New listing'}
          </Text>
        </Pressable>
        <View style={styles.locationRow}>
          <Icon color={colors.subtleText} name="location-outline" size={15} />
          <Text style={styles.location}>
            {vehicle.location.city}, {vehicle.location.province}
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={keySpecifications
            .map((specification) => `${specification.label}: ${specification.value}`)
            .join(', ')}
          style={styles.detailSpecifications}
        >
          {keySpecifications.map((specification) => (
            <View key={specification.label} accessible={false} style={styles.detailSpecification}>
              <Icon color={colors.primary} name={specification.icon} size={18} />
              <Text accessible={false} style={styles.detailSpecificationText}>
                {specification.value}
              </Text>
            </View>
          ))}
        </View>
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
      <Modal
        animationType="slide"
        onRequestClose={closeTripConfiguration}
        presentationStyle="pageSheet"
        visible={tripOpen}
      >
        <Screen
          bottomAccessory={
            <View
              style={[styles.tripSheetBar, { paddingBottom: Math.max(bottomSafeArea, spacing.sm) }]}
            >
              <View accessible accessibilityLabel="Advisory daily price" style={styles.flex}>
                <Text style={styles.bookingBarContext}>Advisory daily price</Text>
                <Text style={styles.bookingBarAmount}>
                  {money(vehicle.pricing.dailyRateMinor, vehicle.pricing.currency)} / day
                </Text>
              </View>
              <View style={styles.bookingBarAction}>
                <Button disabled={!draftTripValid} label="Save" onPress={saveTripConfiguration} />
              </View>
            </View>
          }
          leading={<BackControl label="Close" onPress={closeTripConfiguration} />}
          title="Your trip"
        >
          <Text style={styles.sectionCopy}>
            Review your dates, times, and handover details. Saving does not request a price.
          </Text>
          <View style={styles.tripDateRange}>
            <View style={styles.flex}>
              <Text style={styles.smallLabel}>Trip dates</Text>
              <Text style={styles.tripDateRangeValue}>
                {draftDatesExplicit ? tripDateSummary(draftPickup, draftReturnAt) : 'Add dates'}
              </Text>
            </View>
            <Button
              compact
              label={draftDatesExplicit ? 'Change dates' : 'Add dates'}
              onPress={() => setTripCalendarOpen(true)}
              variant="secondary"
            />
          </View>
          {durationDiscounts.length > 0 && draftDiscountMessage && (
            <View style={styles.tripDurationHint}>
              <Icon color={colors.primaryDark} name="sparkles-outline" size={17} />
              <View style={styles.flex}>
                {draftDatesExplicit && (
                  <Text style={styles.tripDurationDays}>
                    {draftChargeableDays} chargeable day{draftChargeableDays === 1 ? '' : 's'}
                  </Text>
                )}
                <Text style={styles.tripDurationCopy}>{draftDiscountMessage}</Text>
                <Text style={styles.tripDurationAdvisory}>
                  Published policy only. Check price for the authoritative discount and total.
                </Text>
              </View>
            </View>
          )}
          <View style={styles.dateGrid}>
            <DateTimeField
              dismissLabel="Close"
              label="Pickup time"
              mode="time"
              value={draftPickup}
              onChange={setDraftPickup}
            />
            <DateTimeField
              dismissLabel="Close"
              label="Return time"
              mode="time"
              value={draftReturnAt}
              onChange={setDraftReturnAt}
            />
          </View>
          <Modal
            animationType="slide"
            onRequestClose={() => setTripCalendarOpen(false)}
            presentationStyle="pageSheet"
            visible={tripCalendarOpen}
          >
            <Screen
              leading={<BackControl label="Close" onPress={() => setTripCalendarOpen(false)} />}
              title="Trip dates"
            >
              <TripDateCalendar
                appliedEnd={draftReturnAt}
                appliedStart={draftPickup}
                preselect={draftDatesExplicit}
                onApply={(start, end) => {
                  const nextPickup = new Date(start);
                  const nextReturnAt = new Date(end);
                  nextPickup.setHours(draftPickup.getHours(), draftPickup.getMinutes(), 0, 0);
                  nextReturnAt.setHours(draftReturnAt.getHours(), draftReturnAt.getMinutes(), 0, 0);
                  setDraftPickup(nextPickup);
                  setDraftReturnAt(nextReturnAt);
                  setDraftDatesExplicit(true);
                  setTripCalendarOpen(false);
                }}
                onClear={() => {
                  setDraftDatesExplicit(false);
                  setTripCalendarOpen(false);
                }}
              />
            </Screen>
          </Modal>
          <SectionHeader title="Pickup method" />
          {vehicle.fulfillment.renterPickupAvailable !==
          vehicle.fulfillment.ownerDeliveryAvailable ? (
            <View style={styles.handoverStatic}>
              <Text style={styles.handoverStaticTitle}>
                {vehicle.fulfillment.renterPickupAvailable ? 'Pickup only' : 'Delivery only'}
              </Text>
              <Text style={styles.note}>
                {vehicle.fulfillment.renterPickupAvailable
                  ? "You'll pick up the vehicle at the owner's agreed pickup location."
                  : 'The owner will deliver the vehicle to your selected location.'}
              </Text>
            </View>
          ) : (
            <View style={styles.quickRow}>
              {vehicle.fulfillment.renterPickupAvailable && (
                <Chip
                  label="Pick up the car"
                  selected={draftStartMethod === 'RENTER_PICKUP'}
                  onPress={() => setDraftStartMethod('RENTER_PICKUP')}
                />
              )}
              {vehicle.fulfillment.ownerDeliveryAvailable && (
                <Chip
                  label="Have it delivered"
                  selected={draftStartMethod === 'OWNER_DELIVERY'}
                  onPress={() => setDraftStartMethod('OWNER_DELIVERY')}
                />
              )}
            </View>
          )}
          {draftStartMethod === 'OWNER_DELIVERY' && (
            <ConfirmedLocationCard
              kind="delivery"
              location={draftDeliveryLocation}
              onChange={() => setPicker('delivery')}
            />
          )}
          <SectionHeader title="Return method" />
          {vehicle.fulfillment.renterReturnAvailable !==
          vehicle.fulfillment.ownerCollectionAvailable ? (
            <View style={styles.handoverStatic}>
              <Text style={styles.handoverStaticTitle}>
                {vehicle.fulfillment.renterReturnAvailable ? 'Return to owner' : 'Owner collection'}
              </Text>
              <Text style={styles.note}>
                {vehicle.fulfillment.renterReturnAvailable
                  ? "You'll return the vehicle to the agreed return location."
                  : 'The owner will collect the vehicle from your selected location.'}
              </Text>
            </View>
          ) : (
            <View style={styles.quickRow}>
              {vehicle.fulfillment.renterReturnAvailable && (
                <Chip
                  label="Return it yourself"
                  selected={draftEndMethod === 'RENTER_RETURN'}
                  onPress={() => setDraftEndMethod('RENTER_RETURN')}
                />
              )}
              {vehicle.fulfillment.ownerCollectionAvailable && (
                <Chip
                  label="Have the owner collect it"
                  selected={draftEndMethod === 'OWNER_COLLECTION'}
                  onPress={() => setDraftEndMethod('OWNER_COLLECTION')}
                />
              )}
            </View>
          )}
          {draftEndMethod === 'OWNER_COLLECTION' && draftStartMethod === 'OWNER_DELIVERY' && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draftSameAsDelivery }}
              onPress={() => {
                setDraftSameAsDelivery(!draftSameAsDelivery);
                if (draftSameAsDelivery) setDraftCollectionLocation(undefined);
              }}
              style={styles.locationRow}
            >
              <Icon
                color={colors.primary}
                name={draftSameAsDelivery ? 'checkbox' : 'square-outline'}
                size={22}
              />
              <Text style={styles.body}>Same as delivery location</Text>
            </Pressable>
          )}
          {draftEndMethod === 'OWNER_COLLECTION' &&
            !(draftStartMethod === 'OWNER_DELIVERY' && draftSameAsDelivery) && (
              <ConfirmedLocationCard
                kind="collection"
                location={draftCollectionLocation}
                onChange={() => setPicker('collection')}
              />
            )}
          {picker && (
            <LocationPicker
              dismissLabel="Close"
              visible
              kind={picker}
              initial={picker === 'collection' ? draftCollectionLocation : draftDeliveryLocation}
              onCancel={() => setPicker(null)}
              onConfirm={(location) => {
                if (picker === 'delivery') setDraftDeliveryLocation(location);
                else setDraftCollectionLocation(location);
                setPicker(null);
              }}
            />
          )}
        </Screen>
      </Modal>
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
                y: Math.max(0, quotePosition.current - stickyHeaderHeight - spacing.sm),
              }),
            );
          }}
        >
          <QuoteCard
            current={!quoteNeedsRefresh || Boolean(properties.reserve.data)}
            quote={quoteData}
            vehicle={vehicle}
            pickup={properties.pickup}
            returnAt={properties.returnAt}
            reserve={properties.reserve}
            continueBooking={properties.continueBooking}
          />
        </View>
      )}
      {vehicle.description && (
        <View style={styles.editorialSection}>
          <SectionHeader title="About this car" />
          <ExpandableDetailText
            accessibilityLabel="full About this car description"
            text={vehicle.description}
          />
        </View>
      )}
      {vehicle.features.length > 0 && (
        <View style={styles.editorialSection}>
          <SectionHeader title="Features" />
          <View style={styles.featureGrid}>
            {visibleFeatures.map((feature) => (
              <View key={feature.id} style={styles.featureItem}>
                <Icon color={colors.primary} name="checkmark-circle-outline" size={19} />
                <Text style={styles.featureLabel}>{feature.name}</Text>
              </View>
            ))}
          </View>
          {vehicle.features.length > visibleFeatures.length && (
            <Button
              compact
              label={`Show all ${vehicle.features.length} features`}
              onPress={() => setFeaturesOpen(true)}
              variant="secondary"
            />
          )}
        </View>
      )}
      <Modal
        animationType="slide"
        onRequestClose={() => setFeaturesOpen(false)}
        presentationStyle="pageSheet"
        visible={featuresOpen}
      >
        <Screen
          leading={<BackControl label="Close" onPress={() => setFeaturesOpen(false)} />}
          title="All features"
          subtitle={`${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim()}
        >
          <View style={styles.featureGrid}>
            {vehicle.features.map((feature) => (
              <View key={feature.id} style={styles.featureItem}>
                <Icon color={colors.primary} name="checkmark-circle-outline" size={19} />
                <Text style={styles.featureLabel}>{feature.name}</Text>
              </View>
            ))}
          </View>
        </Screen>
      </Modal>
      <View style={styles.editorialSection}>
        <SectionHeader title="Things to know" />
        <PolicyRow
          icon="speedometer-outline"
          title="Mileage"
          value={
            vehicle.mileagePolicy.type === 'UNLIMITED'
              ? 'Unlimited mileage'
              : `${vehicle.mileagePolicy.includedKilometersPerChargeableDay} km included per rental day`
          }
        />
        {typeof vehicle.mileagePolicy.excessKilometerRateMinor === 'number' &&
          vehicle.mileagePolicy.excessKilometerRateMinor > 0 && (
            <PolicyRow
              icon="add-circle-outline"
              title="Excess mileage"
              value={`${money(vehicle.mileagePolicy.excessKilometerRateMinor)} per excess whole kilometer, based on inspection readings`}
            />
          )}
        {vehicle.powertrain === 'BATTERY_ELECTRIC' &&
          (vehicle.returnPolicy?.ev ||
            typeof vehicle.returnPolicy?.evRequiredPercentage === 'number') && (
            <PolicyRow
              icon="flash-outline"
              title="Charging on return"
              value={[
                typeof vehicle.returnPolicy?.evRequiredPercentage === 'number'
                  ? `Return with at least ${vehicle.returnPolicy.evRequiredPercentage}% charge`
                  : null,
                vehicle.returnPolicy?.ev ? domainLabel(vehicle.returnPolicy.ev) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          )}
        {vehicle.powertrain !== 'BATTERY_ELECTRIC' && vehicle.returnPolicy?.fuel && (
          <PolicyRow
            icon="water-outline"
            title="Fuel on return"
            value={domainLabel(vehicle.returnPolicy.fuel)}
          />
        )}
        {typeof vehicle.turnaroundMinutes === 'number' && vehicle.turnaroundMinutes > 0 && (
          <PolicyRow
            icon="time-outline"
            title="Vehicle preparation"
            value={`${noticeLabel(vehicle.turnaroundMinutes)} between rentals for owner preparation`}
          />
        )}
      </View>
      {vehicle.rentalRequirements && (
        <View style={styles.editorialSection}>
          <SectionHeader title="Rental requirements" />
          <ExpandableDetailText
            accessibilityLabel="full rental requirements"
            compactLength={180}
            text={vehicle.rentalRequirements}
          />
        </View>
      )}
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
      <SectionHeader title="Meet your host" />
      <Pressable
        accessibilityHint="Opens the public host profile"
        accessibilityLabel={`View ${vehicle.owner.displayName}'s host profile`}
        accessibilityRole="button"
        onPress={() =>
          navigation.navigate('HostProfile', { hostReference: vehicle.owner.publicReference })
        }
        style={({ pressed }) => [styles.hostSectionCard, pressed && styles.explorePressed]}
      >
        <View style={styles.hostIdentity}>
          {vehicle.owner.avatar?.contentPath ? (
            <Image
              accessible
              accessibilityLabel={`${vehicle.owner.displayName}'s profile photo`}
              contentFit="cover"
              source={{ uri: apiClient.assetUrl(vehicle.owner.avatar.contentPath) }}
              style={styles.ownerAvatarImage}
              transition={180}
            />
          ) : (
            <View
              accessible
              accessibilityLabel={`${vehicle.owner.displayName}, profile photo unavailable`}
              style={styles.ownerAvatar}
            >
              <Icon color={colors.primary} name="person" />
            </View>
          )}
          <View style={styles.flex}>
            <Text style={styles.hostName}>{vehicle.owner.displayName}</Text>
            {vehicle.owner.verified && (
              <View accessibilityLabel="Verified host" style={styles.hostVerified}>
                <Icon color={colors.primary} name="checkmark-circle" size={17} />
                <Text style={styles.hostVerifiedText}>Verified</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.hostMetrics}>
          {vehicle.owner.rating?.averageRating && (
            <View style={styles.hostMetric}>
              <Text style={styles.hostMetricValue}>★ {vehicle.owner.rating.averageRating}</Text>
              <Text style={styles.hostMetricLabel}>Host rating</Text>
            </View>
          )}
          {vehicle.owner.rating?.averageRating && vehicle.owner.rating.reviewCount > 0 && (
            <View style={styles.hostMetric}>
              <Text style={styles.hostMetricValue}>{vehicle.owner.rating.reviewCount}</Text>
              <Text style={styles.hostMetricLabel}>
                {vehicle.owner.rating.reviewCount === 1 ? 'Review' : 'Reviews'}
              </Text>
            </View>
          )}
          {typeof hostSummary.data?.completedRentalCount === 'number' && (
            <View style={styles.hostMetric}>
              <Text style={styles.hostMetricValue}>{hostSummary.data.completedRentalCount}</Text>
              <Text style={styles.hostMetricLabel}>
                {hostSummary.data.completedRentalCount === 1
                  ? 'Completed rental'
                  : 'Completed rentals'}
              </Text>
            </View>
          )}
          {memberSinceYear && Number.isFinite(memberSinceYear) && (
            <View style={styles.hostMetric}>
              <Text style={styles.hostMetricValue}>{memberSinceYear}</Text>
              <Text style={styles.hostMetricLabel}>Hosting since</Text>
            </View>
          )}
        </View>
        <View style={styles.hostProfileAction}>
          <Text style={styles.hostProfileActionText}>View host profile</Text>
          <Icon color={colors.primary} name="chevron-forward" size={18} />
        </View>
      </Pressable>
      <View style={styles.editorialSection}>
        <SectionHeader
          title={
            vehicle.rating?.averageRating && vehicle.rating.reviewCount > 0
              ? `★ ${vehicle.rating.averageRating} · ${vehicle.rating.reviewCount} ${vehicle.rating.reviewCount === 1 ? 'review' : 'reviews'}`
              : 'Reviews'
          }
        />
        {!vehicle.rating?.reviewCount ? (
          <Text style={styles.body}>No reviews yet</Text>
        ) : reviewPreview.isPending ? (
          <Text accessibilityLiveRegion="polite" style={styles.note}>
            Loading review preview…
          </Text>
        ) : reviewPreview.isError ? (
          <Text accessibilityRole="alert" style={styles.note}>
            Review preview is unavailable. You can still open all published reviews.
          </Text>
        ) : (
          <View style={styles.reviewPreviewList}>
            {(reviewPreview.data?.items ?? []).map((review) => {
              const reviewer = review.author.profile?.firstName ?? 'Guest';
              return (
                <View key={review.id} style={styles.reviewPreview}>
                  <View
                    accessible
                    accessibilityLabel={`${reviewer}, rated ${review.rating} out of 5`}
                    style={styles.reviewPreviewHeader}
                  >
                    <Text style={styles.reviewAuthor}>{reviewer}</Text>
                    <Text style={styles.reviewRating}>Rated {review.rating} out of 5</Text>
                  </View>
                  {review.text && (
                    <ExpandableDetailText
                      accessibilityLabel={`full review by ${reviewer}`}
                      compactLength={180}
                      text={review.text}
                    />
                  )}
                  <Text style={styles.reviewDate}>{dateTimeLabel(review.createdAt)}</Text>
                </View>
              );
            })}
          </View>
        )}
        {vehicle.rating?.reviewCount ? (
          <Button
            label={
              vehicle.rating.reviewCount > (reviewPreview.data?.items.length ?? 0)
                ? `Read all ${vehicle.rating.reviewCount} reviews`
                : vehicle.rating.reviewCount === 1
                  ? 'View review'
                  : `View ${vehicle.rating.reviewCount} reviews`
            }
            onPress={openReviews}
            variant="secondary"
          />
        ) : null}
      </View>
    </Screen>
  );
}

function ExpandableDetailText({
  text,
  accessibilityLabel,
  compactLength = 220,
}: {
  readonly text: string;
  readonly accessibilityLabel: string;
  readonly compactLength?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandable = text.trim().length > compactLength;
  return (
    <View style={styles.expandableCopy}>
      <Text numberOfLines={expandable && !expanded ? 4 : undefined} style={styles.description}>
        {text}
      </Text>
      {expandable && (
        <Pressable
          accessibilityHint={
            expanded ? `Collapses ${accessibilityLabel}` : `Reveals ${accessibilityLabel}`
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
          style={styles.editorialAction}
        >
          <Text style={styles.editorialActionText}>{expanded ? 'Show less' : 'Show more'}</Text>
          <Icon color={colors.primary} name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
        </Pressable>
      )}
    </View>
  );
}

function PolicyRow({
  icon,
  title,
  value,
}: {
  readonly icon: ComponentProps<typeof Icon>['name'];
  readonly title: string;
  readonly value: string;
}) {
  return (
    <View style={styles.policyRow}>
      <View style={styles.policyIcon}>
        <Icon color={colors.primary} name={icon} size={20} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.policyTitle}>{title}</Text>
        <Text style={styles.policyValue}>{value}</Text>
      </View>
    </View>
  );
}

function QuoteCard({
  current,
  quote,
  vehicle,
  pickup,
  returnAt,
  reserve,
  continueBooking,
}: {
  readonly current: boolean;
  readonly quote: Quote;
  readonly vehicle: VehicleDetail;
  readonly pickup: Date;
  readonly returnAt: Date;
  readonly reserve: ReturnType<typeof useMutation<BookingView, Error, string>>;
  readonly continueBooking: ReturnType<typeof useMutation<PaymentSetupResult, Error, string>>;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const expiryTime = timeLabel(quote.expiresAt);
  if (!current && !reserve.data)
    return (
      <Card style={styles.quoteCard}>
        <SectionHeader title="Price needs refreshing" />
        <Text style={styles.body}>
          This quote is no longer current. Check the current price to confirm availability,
          fulfillment, and the authoritative trip total again.
        </Text>
      </Card>
    );
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
  onRetry,
}: {
  readonly data?:
    { items: readonly { vehicle: VehicleDetail }[]; unavailableCount: number } | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly onOpen: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onRetry: () => void;
}) {
  return (
    <Screen
      leading={<BackControl label="Back" onPress={onBack} />}
      eyebrow="Saved cars"
      title="Wishlist"
      subtitle="Cars you save will appear here."
    >
      {loading && <StateView loading title="Loading saved cars…" />}
      {error && (
        <StateView
          icon="cloud-offline-outline"
          title="Wishlist unavailable"
          message={error.message}
          actionLabel="Retry"
          onAction={onRetry}
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
          title="No saved cars yet"
          message="Tap the heart on a vehicle to save it here."
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
            label="Remove from Wishlist"
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
  appliedStart,
  appliedEnd,
  locationEstablished,
  datesEstablished,
  onClose,
  onClearError,
  onCurrent,
  onSearch,
  error,
}: {
  readonly open: boolean;
  readonly selected: SearchLocation;
  readonly appliedStart: Date;
  readonly appliedEnd: Date;
  readonly locationEstablished: boolean;
  readonly datesEstablished: boolean;
  readonly onClose: () => void;
  readonly onClearError: () => void;
  readonly onCurrent: () => Promise<SearchLocation | null>;
  readonly onSearch: (draft: SearchDraft) => void;
  readonly error: string;
}) {
  const [whereExpanded, setWhereExpanded] = useState(true);
  const [whenExpanded, setWhenExpanded] = useState(false);
  const [draftSelected, setDraftSelected] = useState(selected);
  const [draftWhereEstablished, setDraftWhereEstablished] = useState(locationEstablished);
  const [draftStart, setDraftStart] = useState(appliedStart);
  const [draftEnd, setDraftEnd] = useState(appliedEnd);
  const [draftDatesEstablished, setDraftDatesEstablished] = useState(datesEstablished);
  const [draftDatesCleared, setDraftDatesCleared] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    readonly { providerReference: string; displayName: string; secondaryText: string }[]
  >([]);
  const [providerError, setProviderError] = useState('');
  const [pending, setPending] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const session = useRef(searchLocationSession());
  const request = useRef(0);
  function resetForOpen() {
    request.current += 1;
    session.current = searchLocationSession();
    setDraftSelected(selected);
    setDraftWhereEstablished(locationEstablished);
    setDraftStart(appliedStart);
    setDraftEnd(appliedEnd);
    setDraftDatesEstablished(datesEstablished);
    setDraftDatesCleared(false);
    setWhereExpanded(!locationEstablished);
    setWhenExpanded(locationEstablished && !datesEstablished);
    setQuery('');
    setSuggestions([]);
    setProviderError('');
    setPending(false);
  }
  useEffect(() => {
    if (!open) {
      request.current += 1;
      return;
    }
    if (query.trim().length < 3) return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      setPending(true);
      setProviderError('');
      bookingLocationProvider
        .searchPlaces(query.trim(), session.current)
        .then((items) => {
          if (id === request.current) setSuggestions(items);
        })
        .catch(() => {
          if (id === request.current)
            setProviderError(
              'Place search is temporarily unavailable. Your current search is unchanged.',
            );
        })
        .finally(() => {
          if (id === request.current) setPending(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [open, query, retryNonce]);
  async function selectSuggestion(providerReference: string) {
    const id = ++request.current;
    setPending(true);
    setProviderError('');
    Keyboard.dismiss();
    try {
      const value = await bookingLocationProvider.resolvePlace(providerReference, session.current);
      if (id !== request.current) return;
      session.current = searchLocationSession();
      onClearError();
      setDraftSelected({
        city: value.city,
        detail: [value.addressLine1, value.city, value.province].filter(Boolean).join(', '),
        label: value.displayName,
        latitude: value.latitude,
        longitude: value.longitude,
        province: value.province,
      });
      setDraftWhereEstablished(true);
      setQuery('');
      setSuggestions([]);
      setWhereExpanded(false);
      setWhenExpanded(true);
    } catch {
      if (id === request.current)
        setProviderError('This place could not be selected. Try another result.');
    } finally {
      if (id === request.current) setPending(false);
    }
  }
  async function selectNearby() {
    setPending(true);
    setProviderError('');
    const selectedCurrentArea = await onCurrent();
    setPending(false);
    if (selectedCurrentArea) {
      setDraftSelected(selectedCurrentArea);
      setDraftWhereEstablished(true);
      setQuery('');
      setSuggestions([]);
      setWhereExpanded(false);
      setWhenExpanded(true);
    }
  }
  function close() {
    Keyboard.dismiss();
    onClose();
  }
  return (
    <Modal
      animationType="slide"
      onShow={resetForOpen}
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={open}
    >
      <Screen
        leading={<BackControl label="Close search" onPress={close} />}
        title="Search cars"
        subtitle="Choose a discovery area. Pickup, Delivery, Return, and Collection locations are confirmed later."
      >
        {whereExpanded ? (
          <Card style={styles.whereCardActive}>
            <Text accessibilityRole="header" style={styles.whereTitle}>
              Where?
            </Text>
            <Text style={styles.whereCopy}>Search destinations, cities or places</Text>
            <View style={styles.placeSearch}>
              <Icon name="search" size={18} />
              <TextInput
                accessibilityLabel="Search destinations, cities or places"
                autoFocus
                onChangeText={(value) => {
                  setQuery(value);
                  setProviderError('');
                  if (value.trim().length < 3) {
                    request.current += 1;
                    setSuggestions([]);
                    setPending(false);
                  }
                }}
                placeholder="Search destinations, cities or places"
                placeholderTextColor={colors.placeholder}
                returnKeyType="search"
                style={styles.placeSearchInput}
                value={query}
              />
              {query.length > 0 ? (
                <IconButton
                  icon="close-circle"
                  label="Clear location search"
                  onPress={() => {
                    request.current += 1;
                    setQuery('');
                    setSuggestions([]);
                    setProviderError('');
                    setPending(false);
                  }}
                />
              ) : null}
            </View>
            {pending ? (
              <Text accessibilityLiveRegion="polite" style={styles.note}>
                Searching places…
              </Text>
            ) : null}
            {providerError ? (
              <View style={styles.whereError}>
                <Text accessibilityRole="alert" style={styles.error}>
                  {providerError}
                </Text>
                {query.trim().length >= 3 ? (
                  <Button
                    label="Retry place search"
                    onPress={() => setRetryNonce((value) => value + 1)}
                    variant="secondary"
                  />
                ) : null}
              </View>
            ) : null}
            {suggestions.map((item) => (
              <Pressable
                accessibilityLabel={[item.displayName, item.secondaryText]
                  .filter(Boolean)
                  .join(', ')}
                accessibilityRole="button"
                key={item.providerReference}
                onPress={() => void selectSuggestion(item.providerReference)}
                style={styles.locationOption}
              >
                <View style={styles.searchIcon}>
                  <Icon color={colors.primary} name="location-outline" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>{item.displayName}</Text>
                  <Text style={styles.body}>{item.secondaryText}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel="Nearby, find cars around your current area"
              accessibilityRole="button"
              disabled={pending}
              onPress={() => void selectNearby()}
              style={styles.nearbyOption}
            >
              <View style={styles.nearbyIcon}>
                <Icon color={colors.primary} name="navigate" size={22} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Nearby</Text>
                <Text style={styles.body}>Find cars around your current area</Text>
              </View>
            </Pressable>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Text style={styles.whereSelectionNote}>
              Current selection: {draftSelected.label}. It stays selected until a replacement is
              confirmed.
            </Text>
          </Card>
        ) : (
          <Pressable
            accessibilityLabel={`Where, ${draftSelected.label}. Edit discovery location`}
            accessibilityRole="button"
            onPress={() => {
              setWhenExpanded(false);
              setWhereExpanded(true);
            }}
            style={styles.searchCollapsedCard}
          >
            <View>
              <Text style={styles.searchCollapsedLabel}>Where</Text>
              <Text numberOfLines={1} style={styles.searchCollapsedValue}>
                {draftSelected.label}
              </Text>
            </View>
            <Text style={styles.searchEdit}>Edit</Text>
          </Pressable>
        )}
        {whenExpanded ? (
          <Card style={styles.whenCardActive}>
            <Text accessibilityRole="header" style={styles.whereTitle}>
              When?
            </Text>
            <Text style={styles.whereCopy}>Select your trip dates</Text>
            <TripDateCalendar
              appliedEnd={draftEnd}
              appliedStart={draftStart}
              preselect={!draftDatesCleared}
              onApply={(start, end) => {
                setDraftStart(start);
                setDraftEnd(end);
                setDraftDatesEstablished(true);
                setDraftDatesCleared(false);
                setWhenExpanded(false);
              }}
              onClear={() => {
                setDraftDatesEstablished(false);
                setDraftDatesCleared(true);
              }}
            />
            <Text style={styles.whereSelectionNote}>
              Discovery uses 9:00 AM search assumptions for both dates. Final handover times are
              confirmed later.
            </Text>
          </Card>
        ) : !whereExpanded && draftDatesEstablished ? (
          <Pressable
            accessibilityLabel={`When, ${tripDateSummary(draftStart, draftEnd)}. Edit trip dates`}
            accessibilityRole="button"
            onPress={() => setWhenExpanded(true)}
            style={styles.searchCollapsedCard}
          >
            <View>
              <Text style={styles.searchCollapsedLabel}>When</Text>
              <Text style={styles.searchCollapsedValue}>
                {tripDateSummary(draftStart, draftEnd)}
              </Text>
            </View>
            <Text style={styles.searchEdit}>Edit</Text>
          </Pressable>
        ) : (
          <Card style={styles.whenCardCollapsed}>
            <Text accessibilityRole="header" style={styles.searchCollapsedLabel}>
              When
            </Text>
            <Text style={styles.searchCollapsedValue}>Add trip dates</Text>
          </Card>
        )}
        {!whereExpanded && !whenExpanded ? (
          <>
            <Button
              disabled={!draftWhereEstablished || !draftDatesEstablished}
              icon="search"
              label="Search"
              onPress={() =>
                onSearch({
                  datesExplicit: draftDatesEstablished,
                  end: draftEnd,
                  place: draftSelected,
                  start: draftStart,
                })
              }
            />
            {!draftWhereEstablished || !draftDatesEstablished ? (
              <Text accessibilityLiveRegion="polite" style={styles.whereSelectionNote}>
                Select and apply trip dates to search.
              </Text>
            ) : null}
          </>
        ) : null}
      </Screen>
    </Modal>
  );
}

type FilterProperties = {
  readonly referenceData?: VehicleReferenceData | undefined;
  readonly priceRange?: NonNullable<SearchResponse['facets']>['pricePerDay'] | undefined;
  readonly filtersOpen: boolean;
  readonly committed: DiscoveryFilters;
  readonly onClose: () => void;
  readonly onApply: (filters: DiscoveryFilters) => void;
};
function FilterSheet(properties: FilterProperties) {
  const { bottom } = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => cloneDiscoveryFilters(properties.committed));
  const [validationError, setValidationError] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const updateDraft = <Key extends keyof DiscoveryFilters>(
    key: Key,
    value: DiscoveryFilters[Key],
  ) => {
    setValidationError('');
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const close = () => {
    setDraft(cloneDiscoveryFilters(properties.committed));
    setValidationError('');
    properties.onClose();
  };
  const apply = () => {
    const error = priceRangeError(draft);
    if (error) {
      setValidationError(error);
      return;
    }
    properties.onApply(draft);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={properties.filtersOpen}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.filterSheet}
      >
        <View style={styles.filterHeader}>
          <Pressable accessibilityLabel="Close filters" accessibilityRole="button" onPress={close}>
            <Text style={styles.filterHeaderAction}>Close</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.filterTitle}>
            Filters
          </Text>
          <View style={styles.filterHeaderSpacer} />
        </View>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.filterContent}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.filterIntro}>
            Narrow the cars shown. Availability and final price are still checked by the platform.
          </Text>
          <FilterSection title="Search area">
            <Text style={styles.filterHelp}>Distance from your selected location</Text>
            <View accessibilityLabel="Search radius" style={styles.quickRow}>
              {[5, 10, 25, 50, 100].map((value) => (
                <Chip
                  key={value}
                  label={`${value} km`}
                  selected={draft.radiusKm === value}
                  onPress={() => updateDraft('radiusKm', value)}
                />
              ))}
            </View>
          </FilterSection>
          <FilterSection title="Vehicle type">
            <View style={styles.quickRow}>
              <Chip
                label="Any"
                selected={!draft.categoryId}
                onPress={() => updateDraft('categoryId', '')}
              />
              {(properties.referenceData?.categories ?? []).map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  selected={draft.categoryId === item.id}
                  onPress={() => updateDraft('categoryId', item.id)}
                />
              ))}
            </View>
            {!properties.referenceData ? (
              <Text accessibilityLiveRegion="polite" style={styles.filterHelp}>
                Loading vehicle types…
              </Text>
            ) : null}
          </FilterSection>
          <FilterSection title="Make">
            <SearchableReferenceSelector
              allowAny
              anyLabel="Any make"
              label="Make"
              options={(properties.referenceData?.makes ?? []).map((item) => ({
                ...item,
                id: item.name,
              }))}
              value={draft.make}
              onChange={(value) => updateDraft('make', value)}
            />
          </FilterSection>
          <FilterSection title="Powertrain">
            <View style={styles.quickRow}>
              {[
                ['', 'Any'],
                ['ICE', 'Gas or diesel'],
                ['HYBRID', 'Hybrid'],
                ['PLUG_IN_HYBRID', 'Plug-in hybrid'],
                ['BATTERY_ELECTRIC', 'Electric'],
              ].map(([value, label]) => (
                <Chip
                  key={value || 'any'}
                  label={label!}
                  selected={draft.powertrain === value}
                  onPress={() => updateDraft('powertrain', value!)}
                />
              ))}
            </View>
          </FilterSection>
          <FilterSection title="Price per day">
            <Text style={styles.filterHelp}>Prices in Philippine pesos (PHP)</Text>
            {properties.priceRange?.currency === 'PHP' &&
            properties.priceRange.maxMinor > properties.priceRange.minMinor ? (
              <PriceRangeSlider
                bounds={properties.priceRange}
                key={`${draft.minPrice}:${draft.maxPrice}:${properties.priceRange.minMinor}:${properties.priceRange.maxMinor}`}
                maximum={
                  draft.maxPrice
                    ? Math.min(
                        properties.priceRange.maxMinor / 100,
                        Math.max(properties.priceRange.minMinor / 100, Number(draft.maxPrice)),
                      )
                    : properties.priceRange.maxMinor / 100
                }
                minimum={
                  draft.minPrice
                    ? Math.max(
                        properties.priceRange.minMinor / 100,
                        Math.min(properties.priceRange.maxMinor / 100, Number(draft.minPrice)),
                      )
                    : properties.priceRange.minMinor / 100
                }
                onChange={(minimum, maximum) => {
                  setValidationError('');
                  setDraft((current) => ({
                    ...current,
                    minPrice: String(minimum),
                    maxPrice: String(maximum),
                  }));
                }}
              />
            ) : null}
            {validationError ? (
              <Text accessibilityLiveRegion="assertive" style={styles.filterError}>
                {validationError}
              </Text>
            ) : null}
          </FilterSection>
          <FilterSection title="Transmission">
            <View style={styles.quickRow}>
              {['', 'AUTOMATIC', 'MANUAL', 'CVT', 'DCT', 'OTHER'].map((value) => (
                <Chip
                  key={value || 'any'}
                  label={value ? domainLabel(value) : 'Any'}
                  selected={draft.transmission === value}
                  onPress={() => updateDraft('transmission', value)}
                />
              ))}
            </View>
          </FilterSection>
          <FilterSection title="Minimum seats">
            <MinimumSeatsSlider
              key={draft.seats || 'any'}
              onChange={(value) => updateDraft('seats', value)}
              value={draft.seats}
            />
          </FilterSection>
          <FilterSection title="Handover options">
            <Text style={styles.filterGroupLabel}>Pickup</Text>
            <View accessibilityLabel="Pickup options" style={styles.quickRow}>
              {[
                ['ANY', 'Any'],
                ['PICKUP_AVAILABLE', 'Pick up the car'],
                ['DELIVERY_AVAILABLE', 'Owner delivery'],
              ].map(([value, label]) => (
                <Chip
                  key={value}
                  label={label!}
                  selected={draft.handover === value}
                  onPress={() => updateDraft('handover', value!)}
                />
              ))}
            </View>
            <Text style={styles.filterGroupLabel}>Return</Text>
            <View accessibilityLabel="Return options" style={styles.quickRow}>
              {[
                ['ANY', 'Any'],
                ['RENTER_RETURN_AVAILABLE', 'Return it yourself'],
                ['OWNER_COLLECTION_AVAILABLE', 'Owner collection'],
              ].map(([value, label]) => (
                <Chip
                  key={value}
                  label={label!}
                  selected={draft.returnHandover === value}
                  onPress={() => updateDraft('returnHandover', value!)}
                />
              ))}
            </View>
          </FilterSection>
        </ScrollView>
        <View
          style={[
            styles.filterActions,
            {
              paddingBottom: Math.max(bottom, spacing.sm) + (keyboardVisible ? spacing.md : 0),
            },
          ]}
        >
          <Button
            label="Clear all"
            onPress={() => {
              setDraft(cloneDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS));
              setValidationError('');
            }}
            variant="ghost"
          />
          <View style={styles.filterApplyButton}>
            <Button label="Show cars" onPress={apply} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FilterSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.filterSection}>
      <SectionHeader title={title} />
      {children}
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
  bookingBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  bookingBarAction: { flex: 1, minWidth: 0 },
  bookingBarAmount: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  bookingBarContext: { color: colors.subtleText, fontSize: 10, fontWeight: '700' },
  bookingBarPrice: { flexShrink: 1, minWidth: 112 },
  bookingBarSuffix: { color: colors.subtleText, fontSize: 11 },
  recoveryAlert: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  recoveryAlertText: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '700' },
  recoveryModalBackdrop: {
    backgroundColor: '#0008',
    flex: 1,
    justifyContent: 'flex-end',
  },
  recoveryModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '85%',
  },
  recoveryModalContent: { gap: spacing.md, padding: spacing.lg },
  recoveryTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  recoverySubtitle: { color: colors.subtleText, fontSize: 15 },
  recoveryAction: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  recoveryActionCopy: { flexGrow: 1, flexShrink: 1, gap: spacing.xxs },
  recoveryActionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  recoveryDeadline: { color: colors.subtleText, fontSize: 13 },
  recoveryReview: { alignItems: 'center', flexDirection: 'row', gap: 2, minHeight: 44 },
  recoveryReviewText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  addressFields: { gap: spacing.sm },
  body: { color: colors.subtleText, lineHeight: 21 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  cardImage: { height: '100%', width: '100%' },
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
  editorialAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xxs,
    minHeight: 44,
  },
  editorialActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  editorialSection: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  expandableCopy: { gap: spacing.xs },
  detailGallery: { flex: 1 },
  detailGalleryControl: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderColor: 'rgba(15,45,35,0.12)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    width: 48,
  },
  detailGalleryControlPressable: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  detailGalleryIndicator: {
    alignItems: 'flex-end',
    bottom: spacing.sm,
    position: 'absolute',
    right: spacing.md,
  },
  detailGalleryShell: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    position: 'relative',
  },
  detailStickyControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1,
  },
  detailStickyHeader: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  detailStickyHeaderBackground: {
    ...StyleSheet.absoluteFillObject,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailHeroInformation: { gap: spacing.xs, paddingTop: spacing.md },
  detailRating: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xxs,
    minHeight: 32,
  },
  detailRatingText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  detailSpecification: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  detailSpecifications: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  detailSpecificationText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  detailTitle: { color: colors.ink, fontSize: 28, fontWeight: '900', lineHeight: 34 },
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
  exploreCategoryContent: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  exploreCategoryRow: { flexGrow: 0, height: 48, marginHorizontal: -spacing.lg },
  exploreFavorite: { position: 'absolute', right: spacing.sm, top: spacing.sm },
  explorePressed: { opacity: 0.78 },
  explorePrice: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  exploreRail: { marginHorizontal: -spacing.lg },
  exploreRailContent: { gap: spacing.md, paddingHorizontal: spacing.lg },
  exploreRating: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  exploreSearchIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  exploreSearchPill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.ink,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  exploreSearchSummary: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  exploreSearchTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  exploreSection: { gap: spacing.xs },
  exploreSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  exploreSectionSubtitle: { color: colors.subtleText, lineHeight: 20, marginBottom: spacing.xs },
  exploreSectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  exploreVehicleBody: { gap: spacing.xxs, padding: spacing.sm },
  exploreVehicleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  exploreVehicleImage: { height: 180, width: '100%' },
  exploreVehicleLocation: { color: colors.subtleText, fontSize: 13 },
  exploreVehicleMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.xxs,
  },
  exploreVehicleTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  savings: {
    color: colors.primary,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  favorite: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.pill,
    elevation: 3,
    position: 'absolute',
    right: spacing.sm,
    shadowColor: colors.ink,
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    top: spacing.sm,
  },
  favoriteCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  favoriteOpen: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  favoriteImage: { borderRadius: radius.md, height: 88, width: 110 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  featureItem: {
    alignItems: 'center',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 40,
  },
  featureLabel: { color: colors.ink, flex: 1, fontSize: 14, lineHeight: 20 },
  filterCount: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: '900',
    minWidth: 18,
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: 'absolute',
    right: -3,
    textAlign: 'center',
    top: -3,
  },
  filterActions: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  filterApplyButton: { flex: 1 },
  filterContent: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filterError: { color: colors.danger, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  filterGroupLabel: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  filterHeader: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
  },
  filterHeaderAction: { color: colors.primary, fontSize: 16, fontWeight: '800', minWidth: 56 },
  filterHeaderSpacer: { minWidth: 56 },
  filterHelp: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  filterIntro: { color: colors.subtleText, fontSize: 14, lineHeight: 21 },
  filterSection: { gap: spacing.sm },
  filterSheet: { backgroundColor: colors.background, flex: 1 },
  filterTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  flex: { flex: 1, minWidth: 0 },
  fullMapListViewport: { minHeight: 0, overflow: 'hidden' },
  fullMapPeekBody: {
    alignItems: 'center',
    alignSelf: 'stretch',
    overflow: 'hidden',
    width: '100%',
  },
  fullMapPeekSummary: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    width: '100%',
  },
  fullMapPeekSummaryArea: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    width: '100%',
  },
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
  fullGallery: { backgroundColor: '#000', flex: 1 },
  fullGalleryClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    width: 48,
  },
  fullGalleryIndicator: {
    alignItems: 'center',
    bottom: spacing.xl,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  hold: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  hostIdentity: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  hostMetric: { flexBasis: '42%', flexGrow: 1, gap: 2 },
  hostMetricLabel: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  hostMetrics: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  hostMetricValue: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  hostName: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  hostProfileAction: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  hostProfileActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  hostSectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  hostVerified: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs, marginTop: 3 },
  hostVerifiedText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
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
  nearbyIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  nearbyOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 68,
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
  handoverStatic: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  handoverStaticTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  ownerAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  ownerAvatarImage: { borderRadius: radius.pill, height: 46, width: 46 },
  priceBox: { alignItems: 'flex-end', maxWidth: '35%' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quoteCard: { gap: spacing.sm },
  resultList: { gap: spacing.md, paddingBottom: 100, paddingHorizontal: spacing.md },
  resultsComposition: { flex: 1 },
  resultsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  resultsHeaderButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    position: 'relative',
    width: 46,
  },
  resultsHeaderButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  resultsHeading: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  normalResultsSummary: { paddingTop: spacing.xs },
  normalResultsSummaryCompact: { paddingTop: spacing.xl },
  mapRestoreButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    elevation: 6,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
  },
  mapRestoreButtonPressed: { opacity: 0.82 },
  mapRestoreLabel: { color: colors.onPrimary, fontSize: 15, fontWeight: '900' },
  mapRestoreLayer: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  resultsMapContainer: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -spacing.lg,
    overflow: 'hidden',
  },
  resultsMapClip: { overflow: 'hidden' },
  resultsQuickFilterScroller: { flexGrow: 0, height: 48 },
  resultsQuickFilters: { gap: spacing.xs, paddingRight: spacing.lg },
  resultsSheet: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    flex: 1,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.sm,
    overflow: 'hidden',
    paddingTop: spacing.xs,
    shadowColor: colors.ink,
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  resultsSheetCollapsed: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    elevation: 0,
    marginTop: 0,
    paddingTop: 0,
    shadowOpacity: 0,
  },
  resultsSheetDragTarget: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    width: '100%',
  },
  resultsSheetDragTargetCollapsed: { height: 0, minHeight: 0 },
  resultsSheetHandle: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 4,
    width: 42,
  },
  reviewAuthor: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  reviewDate: { color: colors.subtleText, fontSize: 12 },
  reviewPreview: { gap: spacing.xs, paddingVertical: spacing.sm },
  reviewPreviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  reviewPreviewList: { gap: spacing.xs },
  reviewRating: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  resultsSearchSummary: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  resultSearchLocation: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  resultsSearchDate: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  resultsSearchTextColumn: {
    alignItems: 'flex-start',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
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
  placeSearch: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  placeSearchInput: { color: colors.ink, flex: 1, minHeight: 48 },
  policyIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  policyRow: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  policyTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  policyValue: { color: colors.subtleText, fontSize: 14, lineHeight: 20, marginTop: 2 },
  searchCollapsedCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 74,
    padding: spacing.md,
  },
  searchCollapsedLabel: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  searchCollapsedValue: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 3 },
  searchEdit: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  tripSheetBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  tripDateRange: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
  },
  tripDateRangeValue: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 },
  tripDurationAdvisory: { color: colors.subtleText, fontSize: 11, marginTop: 2 },
  tripDurationCopy: { color: colors.primaryDark, fontSize: 13, lineHeight: 18 },
  tripDurationDays: { color: colors.ink, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  tripDurationHint: {
    alignItems: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
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
    gap: spacing.sm,
    position: 'relative',
  },
  vehicleAttributes: { color: colors.subtleText, fontSize: 14, lineHeight: 20 },
  vehicleCardOpen: { gap: spacing.sm },
  vehicleCardPressed: { opacity: 0.84 },
  vehicleContent: { gap: spacing.xs, paddingHorizontal: spacing.xxs },
  vehicleImageFrame: {
    aspectRatio: 1.6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    maxHeight: 240,
    overflow: 'hidden',
    width: '100%',
  },
  vehicleLocation: { color: colors.subtleText, flex: 1, fontSize: 13 },
  vehicleLocationRatingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleNotice: { color: colors.subtleText, fontSize: 12, lineHeight: 18 },
  vehiclePrice: { color: colors.ink, flexShrink: 0, fontSize: 18, fontWeight: '900' },
  vehiclePriceFulfillmentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  vehiclePriceUnit: { color: colors.subtleText, fontSize: 13, fontWeight: '600' },
  vehicleRating: { color: colors.ink, flexShrink: 0, fontSize: 13, fontWeight: '800' },
  vehicleTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', lineHeight: 23 },
  whenCardActive: {
    borderColor: colors.primary,
    borderWidth: 1,
    gap: spacing.sm,
  },
  whenCardCollapsed: { gap: spacing.xxs, opacity: 0.72 },
  whereCardActive: {
    borderColor: colors.primary,
    borderWidth: 1,
    gap: spacing.sm,
  },
  whereCopy: { color: colors.subtleText, lineHeight: 20 },
  whereError: { gap: spacing.xs },
  whereSelectionNote: { color: colors.subtleText, fontSize: 12, lineHeight: 18 },
  whereTitle: { color: colors.ink, fontSize: 26, fontWeight: '900' },
});
