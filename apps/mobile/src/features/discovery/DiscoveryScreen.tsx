import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  cancelAnimation,
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
  type FlatList,
  findNodeHandle,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
type ExploreShortcut = 'ALL' | 'NEARBY' | 'EV' | 'SEVEN_PLUS' | `CATEGORY:${string}` | 'CUSTOM';
type VehicleReferenceData = {
  readonly categories: readonly ReferenceOption[];
  readonly makes: readonly ReferenceOption[];
};
type SearchDraft = {
  readonly place: SearchLocation;
  readonly start: Date;
  readonly end: Date;
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

export function DiscoveryScreen({
  home = false,
  initialMode = 'form',
  initialVehicleId,
  onExit,
  onFullMapChange,
}: {
  readonly home?: boolean;
  readonly initialMode?: 'form' | 'favorites';
  readonly initialVehicleId?: string | undefined;
  readonly onExit?: (() => void) | undefined;
  readonly onFullMapChange?: ((active: boolean) => void) | undefined;
}) {
  const navigation = useNavigation<NavigationProp<RenterTabParamList & RootStackParamList>>();
  const { bottom: bottomSafeArea } = useSafeAreaInsets();
  const client = useQueryClient();
  const [mode, setMode] = useState<ViewMode>(initialVehicleId ? 'detail' : initialMode);
  const detailOrigin = useRef<ViewMode>(initialMode === 'favorites' ? 'favorites' : 'results');
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
  const [locationError, setLocationError] = useState('');
  const [exploreSearchOpen, setExploreSearchOpen] = useState(false);
  const [recoveryActionsOpen, setRecoveryActionsOpen] = useState(false);
  const [recoveryClock, setRecoveryClock] = useState(() => Date.now());
  const seenRecoveryActionKeys = useRef(new Set<string>());
  const recoveryAlertRef = useRef<View>(null);
  const recoveryTitleRef = useRef<Text>(null);
  const [exploreShortcut, setExploreShortcut] = useState<ExploreShortcut>('ALL');
  const [discoveryLocationEstablished, setDiscoveryLocationEstablished] = useState(false);
  const [tripDatesEstablished, setTripDatesEstablished] = useState(false);
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const initialResultsMapHeight = Math.max(220, Math.min(340, Math.round(viewportHeight * 0.34)));
  const mapCollapseDistance = Math.max(190, Math.min(280, initialResultsMapHeight * 0.85));
  const mapTransientUiDismissOffset = Math.min(32, mapCollapseDistance * 0.15);
  const fullMapGestureThreshold = 72;
  const fullMapPeekHeight = Math.max(92, Math.min(124, 96 + bottomSafeArea));
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
  ]);
  const listQueryString = `${activeCriteriaQueryString}&limit=10&mode=LIST`;
  const mapQueryString = `${activeCriteriaQueryString}&limit=50&mode=MAP`;
  const listSearch = useInfiniteQuery({
    enabled: mode === 'results' || home,
    refetchInterval: mode === 'results' || home ? 5_000 : false,
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
      ? initialResultsMapHeight + (fullMapHeight - initialResultsMapHeight) * fullMapProgress.value
      : Math.max(0, initialResultsMapHeight * (1 - collapseProgress.value)),
    marginTop: fullMapPresentationOnUi.value
      ? spacing.sm
      : spacing.sm * (1 - collapseProgress.value),
    opacity: fullMapPresentationOnUi.value
      ? 1
      : collapseProgress.value <= 0.72
        ? 1 - collapseProgress.value * (0.28 / 0.72)
        : 0.72 * ((1 - collapseProgress.value) / 0.28),
  }));
  const fullMapSheetStyle = useAnimatedStyle(() => ({
    height:
      !mapFullyCollapsed || fullMapPresentationOnUi.value
        ? splitResultsHeight + (fullMapPeekHeight - splitResultsHeight) * fullMapProgress.value
        : undefined,
  }));
  const fullMapListViewportStyle = useAnimatedStyle(() => ({
    height:
      !mapFullyCollapsed || fullMapPresentationOnUi.value
        ? Math.max(0, splitResultsHeight - fullMapHandleRegionHeight) * (1 - fullMapProgress.value)
        : undefined,
  }));
  const fullMapContentStyle = useAnimatedStyle(() => ({
    opacity:
      fullMapProgress.value <= 0.6
        ? 1
        : fullMapProgress.value >= 0.78
          ? 0
          : 1 - (fullMapProgress.value - 0.6) / 0.18,
  }));
  const fullMapPeekStyle = useAnimatedStyle(() => ({
    height: fullMapPeekBodyHeight * fullMapProgress.value,
    opacity:
      fullMapProgress.value <= 0.78
        ? 0
        : fullMapProgress.value >= 0.9
          ? 1
          : (fullMapProgress.value - 0.78) / 0.12,
  }));
  const collapseHandleStyle = useAnimatedStyle(() => ({
    opacity: 1 - collapseProgress.value,
  }));
  useEffect(() => {
    onFullMapChange?.(mode === 'results' && fullMap);
  }, [fullMap, mode, onFullMapChange]);
  useEffect(() => () => onFullMapChange?.(false), [onFullMapChange]);
  useEffect(() => {
    if (!fullMap || !listSearch.isError || !mapSearch.isError) return;
    const timer = setTimeout(settleFullMapExit, 0);
    return () => clearTimeout(timer);
    // The exit settlement is intentionally shared with gesture, tap, and accessibility exits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMap, fullMapProgress, listSearch.isError, mapSearch.isError]);
  const exploreScrollRef = useRef<ScrollView>(null);
  const searchFormOffset = useRef(0);
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
    if (mode === 'detail' || mode === 'quote') {
      reserve.reset();
      void invalidateRenterVerification(client);
      return;
    }
    if (mode === 'results') {
      void listSearch.refetch();
      void mapSearch.refetch();
    } else if (home) void listSearch.refetch();
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
  function performSearch(draft?: SearchDraft) {
    const nextPlace = draft?.place ?? place;
    const nextStart = draft?.start ?? pickup;
    const nextEnd = draft?.end ?? returnAt;
    if (nextEnd.getTime() <= nextStart.getTime()) return;
    Keyboard.dismiss();
    setPlace(nextPlace);
    setActivePlace(nextPlace);
    setPickup(nextStart);
    setReturnAt(nextEnd);
    setActiveRadiusKm(radiusKm);
    setDiscoveryLocationEstablished(true);
    setTripDatesEstablished(true);
    resetResultsViewport();
    setMode('results');
  }
  function searchMapArea(area: MapSearchArea) {
    setActivePlace((current) => ({
      ...current,
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

  function openLegacySearch(draft?: SearchDraft) {
    if (draft) {
      setPlace(draft.place);
      setPickup(draft.start);
      setReturnAt(draft.end);
    }
    setLocationOpen(false);
    setExploreSearchOpen(true);
    setMode('form');
    setTimeout(
      () => exploreScrollRef.current?.scrollTo({ animated: true, y: searchFormOffset.current }),
      0,
    );
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

  function restoreResultsMap() {
    if (mapRestoreInProgress.current) return;
    mapRestoreInProgress.current = true;
    resultListRef.current?.scrollToOffset({ animated: true, offset: 0 });
    observedListOffset.value = 0;
    topReachedTravel.value = -1;
    reverseRestorationActive.value = false;
    collapseProgress.value = withTiming(0, { duration: 180 }, (finished) => {
      if (finished) runOnJS(commitForwardPresentation)(false, 0);
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

  const searchEditor = (
    <LocationSheet
      appliedEnd={returnAt}
      appliedStart={pickup}
      datesEstablished={tripDatesEstablished}
      error={locationError}
      locationEstablished={discoveryLocationEstablished}
      onClose={() => setLocationOpen(false)}
      onClearError={() => setLocationError('')}
      onContinue={openLegacySearch}
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
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.resultSearchLocation}>
                {activePlace.label}
              </Text>
              <Text numberOfLines={1} style={styles.dateSummaryText}>
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
              !mapFullyCollapsed && styles.resultsSheetFullMap,
              fullMapSheetStyle,
            ]}
          >
            <GestureDetector gesture={handleFullMapEntryGesture}>
              <Reanimated.View
                accessible={false}
                importantForAccessibility="no"
                style={styles.resultsSheetDragTarget}
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
                style={[
                  styles.flex,
                  !mapFullyCollapsed && styles.fullMapListViewport,
                  fullMapListViewportStyle,
                ]}
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
                        ref={resultListRef}
                        style={styles.flex}
                        data={searchItems}
                        keyExtractor={(item) => item.vehicleId}
                        ListHeaderComponent={<NormalResultsSummary summary={resultSummary} />}
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
              style={[
                styles.mapRestoreLayer,
                { bottom: Math.max(spacing.md, bottomSafeArea + spacing.xs) },
              ]}
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
            referenceData={reference.data}
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
              prepareResultsFilterChange();
              setActiveRadiusKm(radiusKm);
              syncExploreShortcut(categoryId, powertrain, seats);
              setFiltersOpen(false);
            }}
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
          animationType="fade"
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
                <Button
                  compact
                  label="Not now"
                  onPress={closeRecoveryActions}
                  variant="secondary"
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
      {(!home || exploreSearchOpen) && (
        <View onLayout={(event) => (searchFormOffset.current = event.nativeEvent.layout.y)}>
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
            <Button
              disabled={!validDates}
              icon="search"
              label="Search cars"
              onPress={performSearch}
            />
          </Card>
        </View>
      )}
      {(!home || exploreSearchOpen) && (
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
            error={listSearch.isError ? listSearch.error : null}
            items={searchItems.slice(0, 6)}
            loading={listSearch.isPending}
            onAdjustSearch={openExploreSearch}
            onFavorite={(vehicle) =>
              favorite.mutate({ id: vehicle.vehicleId, active: vehicle.favorite })
            }
            onOpen={(vehicle) => openVehicle(vehicle.vehicleId)}
            onRetry={() => void listSearch.refetch()}
            subtitle="Available for your selected times. Final price is confirmed before you reserve."
            title={
              discoveryLocationEstablished
                ? `Cars near ${activePlace.label}`
                : exploreShortcut === 'EV'
                  ? 'Electric vehicles'
                  : exploreShortcut === 'SEVEN_PLUS'
                    ? 'Cars with 7+ seats'
                    : categoryShortcuts.some(({ id }) => exploreShortcut === `CATEGORY:${id}`)
                      ? `${categoryShortcuts.find(({ id }) => exploreShortcut === `CATEGORY:${id}`)?.label} cars`
                      : 'Explore cars'
            }
          />
        </>
      )}
      {searchEditor}
      <FilterSheet
        referenceData={reference.data}
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
          setExploreShortcut('CUSTOM');
          setFiltersOpen(false);
        }}
      />
    </Screen>
  );
}

function NormalResultsSummary({ summary }: { readonly summary: string }) {
  return (
    <View style={styles.normalResultsSummary}>
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
  loading,
  error,
  onOpen,
  onFavorite,
  onRetry,
  onAdjustSearch,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly items: readonly VehicleCardView[];
  readonly cardWidth: number;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onOpen: (vehicle: VehicleCardView) => void;
  readonly onFavorite: (vehicle: VehicleCardView) => void;
  readonly onRetry: () => void;
  readonly onAdjustSearch: () => void;
}) {
  return (
    <View accessibilityLabel={`${title} vehicle section`} style={styles.exploreSection}>
      <Text accessibilityRole="header" style={styles.exploreSectionTitle}>
        {title}
      </Text>
      <Text style={styles.exploreSectionSubtitle}>{subtitle}</Text>
      {loading ? (
        <View style={[styles.exploreLoadingCard, { width: cardWidth }]}>
          <StateView loading title="Loading cars…" />
        </View>
      ) : error ? (
        <StateView
          icon="cloud-offline-outline"
          title="Couldn’t load cars"
          message={error.message}
          actionLabel="Retry"
          onAction={onRetry}
        />
      ) : items.length === 0 ? (
        <StateView
          icon="car-outline"
          title="No cars match this search"
          message="Try another location, category, or search filter."
          actionLabel="Adjust search"
          onAction={onAdjustSearch}
        />
      ) : (
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
      )}
    </View>
  );
}

function ExploreVehicleCard({
  vehicle,
  cardWidth,
  onOpen,
  onFavorite,
}: {
  readonly vehicle: VehicleCardView;
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
          label={vehicle.favorite ? 'Remove from Wishlist' : 'Save to Wishlist'}
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
        <SectionHeader
          title={
            vehicle.fulfillment.renterPickupAvailable && vehicle.fulfillment.ownerDeliveryAvailable
              ? 'How would you like to receive the car?'
              : "How you'll receive the car"
          }
        />
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
        )}
        {startMethod === 'OWNER_DELIVERY' && (
          <ConfirmedLocationCard
            kind="delivery"
            location={deliveryLocation}
            onChange={() => setPicker('delivery')}
          />
        )}
        <SectionHeader
          title={
            vehicle.fulfillment.renterReturnAvailable &&
            vehicle.fulfillment.ownerCollectionAvailable
              ? 'How would you like to return the car?'
              : "How you'll return the car"
          }
        />
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
        )}
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
  onContinue,
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
  readonly onContinue: (draft: SearchDraft) => void;
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
            <Button
              label="Continue with exact times"
              onPress={() => onContinue({ end: draftEnd, place: draftSelected, start: draftStart })}
              variant="ghost"
            />
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
              onPress={() => onSearch({ end: draftEnd, place: draftSelected, start: draftStart })}
            />
            {!draftWhereEstablished || !draftDatesEstablished ? (
              <Text accessibilityLiveRegion="polite" style={styles.whereSelectionNote}>
                Select and apply trip dates to search.
              </Text>
            ) : null}
            <Button
              label="Continue with exact times"
              onPress={() => onContinue({ end: draftEnd, place: draftSelected, start: draftStart })}
              variant="ghost"
            />
          </>
        ) : null}
      </Screen>
    </Modal>
  );
}

type FilterProperties = {
  readonly referenceData?: VehicleReferenceData | undefined;
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
          options={(properties.referenceData?.makes ?? []).map((item) => ({
            ...item,
            id: item.name,
          }))}
          value={properties.make}
          onChange={properties.setMake}
        />
        <SearchableReferenceSelector
          allowAny
          anyLabel="Any vehicle type"
          label="Vehicle type"
          options={properties.referenceData?.categories ?? []}
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
  exploreCategoryContent: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  exploreCategoryRow: { flexGrow: 0, height: 48, marginHorizontal: -spacing.lg },
  exploreFavorite: { position: 'absolute', right: spacing.sm, top: spacing.sm },
  exploreLoadingCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 270,
    padding: spacing.md,
  },
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
  exploreSectionSubtitle: { color: colors.subtleText, lineHeight: 20, marginBottom: spacing.xs },
  exploreSectionTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
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
  flex: { flex: 1, minWidth: 0 },
  fullMapListViewport: { flex: 0, overflow: 'hidden' },
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
    shadowOpacity: 0,
  },
  resultsSheetFullMap: { flex: 0, marginTop: -spacing.sm },
  resultsSheetDragTarget: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    width: '100%',
  },
  resultsSheetHandle: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 4,
    width: 42,
  },
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
