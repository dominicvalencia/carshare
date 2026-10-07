import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import { BackControl, Button, Icon } from '../ui/primitives';
import {
  bookingLocationProvider,
  locationDisplayLabel,
  locationLabel,
  type BookingLocationProvider,
  type CarShareLocation,
  type PlaceSuggestion,
} from './booking-location-provider';

const FALLBACK = {
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
const sessionToken = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;

export function LocationPicker({
  visible,
  kind,
  initial,
  title,
  description,
  confirmLabel,
  mapAccessibilityLabel,
  mapGuidance,
  allowCurrentLocation = true,
  dismissLabel = 'Cancel location selection',
  presentation = 'default',
  onCancel,
  onConfirm,
  provider = bookingLocationProvider,
}: {
  readonly visible: boolean;
  readonly kind: 'delivery' | 'collection' | 'pickup';
  readonly initial: CarShareLocation | undefined;
  readonly title?: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly mapAccessibilityLabel?: string;
  readonly mapGuidance?: string;
  readonly allowCurrentLocation?: boolean;
  readonly dismissLabel?: string;
  readonly presentation?: 'default' | 'vehicleSetup';
  readonly onCancel: () => void;
  readonly onConfirm: (location: CarShareLocation) => void;
  readonly provider?: BookingLocationProvider;
}) {
  const vehicleSetup = presentation === 'vehicleSetup';
  const safeArea = useSafeAreaInsets();
  const vehicleSetupInsets = vehicleSetup
    ? {
        paddingBottom: Math.max(safeArea.bottom, spacing.sm) + spacing.sm,
        paddingTop: Math.max(safeArea.top, spacing.xxl) + spacing.sm,
      }
    : undefined;
  const map = useRef<MapView>(null);
  const request = useRef(0);
  const skipNextMapResolution = useRef(false);
  const session = useRef(sessionToken());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly PlaceSuggestion[]>([]);
  const [pending, setPending] = useState<CarShareLocation | undefined>(initial);
  const [region, setRegion] = useState<Region>(
    initial
      ? {
          latitude: initial.latitude,
          longitude: initial.longitude,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        }
      : FALLBACK,
  );
  const [status, setStatus] = useState<'idle' | 'searching' | 'resolving' | 'locating'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible || query.trim().length < 3) return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      setStatus('searching');
      provider
        .searchPlaces(query.trim(), session.current)
        .then((items) => {
          if (id === request.current) setResults(items);
        })
        .catch(() => {
          if (id === request.current)
            setError('Address search is unavailable. Try again or choose a point on the map.');
        })
        .finally(() => {
          if (id === request.current) setStatus('idle');
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [provider, query, visible]);
  const resolveCoordinates = async (next: Region) => {
    const id = ++request.current;
    setPending(undefined);
    setError('');
    setStatus('resolving');
    try {
      const value = await provider.reverseGeocode(next.latitude, next.longitude);
      if (id === request.current) setPending(value);
    } catch {
      if (id === request.current)
        setError('We could not resolve this point to an address. Move the map or try again.');
    } finally {
      if (id === request.current) setStatus('idle');
    }
  };
  const select = async (item: PlaceSuggestion) => {
    const id = ++request.current;
    Keyboard.dismiss();
    setError('');
    setStatus('resolving');
    try {
      const value = await provider.resolvePlace(item.providerReference, session.current);
      if (id !== request.current) return;
      setPending(value);
      const next = {
        latitude: value.latitude,
        longitude: value.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      };
      setRegion(next);
      skipNextMapResolution.current = true;
      map.current?.animateToRegion(next);
      setResults([]);
      session.current = sessionToken();
    } catch {
      if (id === request.current)
        setError('This place could not be resolved. Choose another result or try again.');
    } finally {
      if (id === request.current) setStatus('idle');
    }
  };
  const current = async () => {
    const id = ++request.current;
    setError('');
    setStatus('locating');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      if (id === request.current) {
        setStatus('idle');
        setError('Location access is off. Search for an address or choose a location on the map.');
      }
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (id !== request.current) return;
      const next = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      };
      setRegion(next);
      skipNextMapResolution.current = true;
      map.current?.animateToRegion(next);
      await resolveCoordinates(next);
    } catch {
      if (id === request.current) {
        setStatus('idle');
        setError(
          'Current location is unavailable. Search for an address or choose a location on the map.',
        );
      }
    }
  };
  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <SafeAreaView
        edges={[]}
        style={[styles.screen, vehicleSetup && styles.vehicleSetupScreen, vehicleSetupInsets]}
      >
        <BackControl label={dismissLabel} onPress={onCancel} />
        <Text
          accessibilityRole="header"
          style={[styles.title, vehicleSetup && styles.vehicleSetupTitle]}
        >
          {title ??
            (kind === 'delivery'
              ? 'Delivery destination'
              : kind === 'collection'
                ? 'Collection destination'
                : 'Private pickup location')}
        </Text>
        <Text style={styles.copy}>
          {description ??
            (kind === 'delivery'
              ? 'Where should we deliver the car?'
              : kind === 'collection'
                ? 'Where should the owner collect the car?'
                : 'Choose the exact pickup and return point for this vehicle.')}
        </Text>
        <View style={styles.search}>
          <Icon name="search" size={18} />
          <TextInput
            accessibilityLabel="Search address or place"
            onChangeText={(value) => {
              setQuery(value);
              if (value.trim().length < 3) setResults([]);
            }}
            placeholder="Search address or place"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={query}
          />
        </View>
        {results.length > 0 && (
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={results}
            keyExtractor={(item) => item.providerReference}
            style={styles.results}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => void select(item)}
                style={styles.result}
              >
                <Text style={styles.resultTitle}>{item.displayName}</Text>
                <Text style={styles.resultCopy}>{item.secondaryText}</Text>
              </Pressable>
            )}
          />
        )}
        {query.trim().length >= 3 && status === 'idle' && results.length === 0 && !error ? (
          <Text style={styles.guidance}>
            No matching places found. Try a more specific street, building, landmark, or city.
          </Text>
        ) : null}
        <View
          accessibilityLabel={mapAccessibilityLabel ?? 'Google map for choosing the handover point'}
          style={[styles.mapWrap, vehicleSetup && styles.vehicleSetupMap]}
        >
          <MapView
            ref={map}
            provider={PROVIDER_GOOGLE}
            initialRegion={region}
            onRegionChangeComplete={(next) => {
              setRegion(next);
              if (skipNextMapResolution.current) {
                skipNextMapResolution.current = false;
                return;
              }
              void resolveCoordinates(next);
            }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.pin}>
            <Icon color={colors.danger} name="location" size={38} />
          </View>
        </View>
        <Text style={[styles.guidance, vehicleSetup && styles.vehicleSetupGuidance]}>
          {mapGuidance ?? 'Move the map to adjust the exact handover point.'}
        </Text>
        {allowCurrentLocation && (!vehicleSetup || status !== 'locating') && (
          <Button
            compact={vehicleSetup}
            disabled={status !== 'idle'}
            icon={vehicleSetup ? 'navigate-outline' : undefined}
            label={status === 'locating' ? 'Finding location…' : 'Use my current location'}
            onPress={() => void current()}
            variant="secondary"
          />
        )}
        {vehicleSetup && status === 'locating' ? (
          <View accessibilityLiveRegion="polite" style={styles.locationStatus}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.locationStatusText}>Finding location…</Text>
          </View>
        ) : null}
        <View style={[styles.summary, vehicleSetup && styles.vehicleSetupSummary]}>
          {vehicleSetup ? (
            <View style={styles.summaryIcon}>
              <Icon color={colors.primary} name="location-outline" size={20} />
            </View>
          ) : null}
          <View style={vehicleSetup && styles.summaryContent}>
            <Text style={styles.summaryTitle}>Selected address</Text>
            <Text style={styles.summaryCopy}>
              {status === 'resolving'
                ? 'Resolving address…'
                : pending
                  ? vehicleSetup
                    ? locationDisplayLabel(pending)
                    : locationLabel(pending)
                  : 'Choose a search result or move the map.'}
            </Text>
          </View>
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={vehicleSetup && styles.vehicleSetupConfirm}>
          <Button
            disabled={!pending || status !== 'idle'}
            label={confirmLabel ?? `Confirm ${kind} location`}
            onPress={() => pending && onConfirm(pending)}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: 54,
  },
  vehicleSetupScreen: { paddingHorizontal: spacing.lg },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  vehicleSetupTitle: { fontSize: 24 },
  copy: { color: colors.subtleText },
  search: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  input: { color: colors.ink, flex: 1, minHeight: 48 },
  results: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    maxHeight: 190,
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: 178,
    zIndex: 4,
  },
  result: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
  },
  resultTitle: { color: colors.ink, fontWeight: '800' },
  resultCopy: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  mapWrap: { borderRadius: radius.md, flex: 1, minHeight: 220, overflow: 'hidden' },
  vehicleSetupMap: { minHeight: 180 },
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
    left: '50%',
    marginLeft: -19,
    marginTop: -38,
    position: 'absolute',
    top: '50%',
  },
  guidance: { color: colors.subtleText, fontSize: 12 },
  vehicleSetupGuidance: { fontSize: 11 },
  summary: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  vehicleSetupSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  summaryContent: { flex: 1 },
  summaryTitle: { color: colors.ink, fontWeight: '800' },
  summaryCopy: { color: colors.subtleText, marginTop: 4 },
  locationStatus: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  locationStatusText: { color: colors.subtleText, fontSize: 13 },
  vehicleSetupConfirm: { paddingBottom: spacing.xs },
  error: { color: colors.danger, fontSize: 13 },
});
