import { useMemo, useRef, useState } from 'react';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Button, StatusBadge } from '../../ui/primitives';
import { VehicleImage } from '../../ui/VehicleImage';
import { money } from '../../ui/format';
import type { VehicleCardView } from './DiscoveryScreen';

export interface MapSearchArea {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusKm: number;
}

interface MapItem extends VehicleCardView {
  readonly mapPosition: {
    readonly mapLatitude: number;
    readonly mapLongitude: number;
    readonly precision: 'APPROXIMATE_CELL';
  };
}

const hasMapPosition = (vehicle: VehicleCardView): vehicle is MapItem =>
  Boolean(vehicle.mapPosition);

export function regionRadiusKm(region: Region): number {
  return Math.max(
    1,
    Math.min(100, Math.ceil(Math.max(region.latitudeDelta, region.longitudeDelta) * 55.5)),
  );
}

export function clusterMapItems(items: readonly MapItem[]) {
  const groups = new Map<string, MapItem[]>();
  for (const item of items) {
    const key = `${Math.round(item.mapPosition.mapLatitude / 0.04)}:${Math.round(item.mapPosition.mapLongitude / 0.04)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

export function DiscoveryMap({
  items,
  initialRegion,
  loading,
  error,
  selectedId,
  onSearchArea,
  onSelect,
  onOpen,
  onRetry,
}: {
  readonly items: readonly VehicleCardView[];
  readonly initialRegion: Region;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly selectedId: string | null;
  readonly onSearchArea: (area: MapSearchArea) => void;
  readonly onSelect: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly onRetry: () => void;
}) {
  const map = useRef<MapView>(null);
  const userMoved = useRef(false);
  const [region, setRegion] = useState(initialRegion);
  const [areaPending, setAreaPending] = useState(false);
  const mapItems = useMemo(() => items.filter(hasMapPosition), [items]);
  const clusters = useMemo(() => clusterMapItems(mapItems), [mapItems]);
  const selected = mapItems.find(({ vehicleId }) => vehicleId === selectedId) ?? null;

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        accessibilityLabel="Approximate vehicle discovery map"
        initialRegion={initialRegion}
        onPanDrag={() => {
          userMoved.current = true;
        }}
        onRegionChangeComplete={(next, details) => {
          setRegion(next);
          if (userMoved.current || details.isGesture) {
            setAreaPending(true);
            userMoved.current = false;
          }
        }}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
      >
        {clusters.map((cluster) => {
          const first = cluster[0]!;
          const coordinate = {
            latitude: first.mapPosition.mapLatitude,
            longitude: first.mapPosition.mapLongitude,
          };
          if (cluster.length > 1)
            return (
              <Marker
                key={`cluster-${coordinate.latitude}-${coordinate.longitude}`}
                accessibilityLabel={`${cluster.length} vehicles in this area`}
                coordinate={coordinate}
                onPress={() => {
                  map.current?.animateToRegion({
                    ...coordinate,
                    latitudeDelta: Math.max(region.latitudeDelta / 2, 0.01),
                    longitudeDelta: Math.max(region.longitudeDelta / 2, 0.01),
                  });
                }}
              >
                <View style={styles.cluster}>
                  <Text style={styles.clusterText}>{cluster.length}</Text>
                </View>
              </Marker>
            );
          const active = first.vehicleId === selectedId;
          return (
            <Marker
              key={first.vehicleId}
              accessibilityLabel={`${first.year} ${first.make} ${first.model}, ${money(first.displayPrice.amountMinor, first.currency)} per day`}
              accessibilityState={{ selected: active }}
              coordinate={coordinate}
              onPress={() => onSelect(first.vehicleId)}
              tracksViewChanges={active}
              zIndex={active ? 2 : 1}
            >
              <View style={[styles.pricePin, active && styles.pricePinSelected]}>
                <Text style={[styles.pricePinText, active && styles.pricePinTextSelected]}>
                  {money(first.displayPrice.amountMinor, first.currency)}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
      <Text style={styles.privacy}>
        Vehicle locations are approximate to protect owner privacy.
      </Text>
      {areaPending ? (
        <View style={styles.searchArea}>
          <Button
            disabled={loading}
            label={loading ? 'Searching…' : 'Search this area'}
            onPress={() => {
              setAreaPending(false);
              onSelect(null);
              onSearchArea({
                latitude: region.latitude,
                longitude: region.longitude,
                radiusKm: regionRadiusKm(region),
              });
            }}
          />
        </View>
      ) : null}
      {error ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>Search unavailable</Text>
          <Text style={styles.messageCopy}>
            The map position is preserved. Try this search again.
          </Text>
          <Button label="Retry" onPress={onRetry} variant="secondary" />
        </View>
      ) : !loading && mapItems.length === 0 ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>No cars found in this area</Text>
          <Text style={styles.messageCopy}>
            Try moving the map, changing dates, or adjusting filters.
          </Text>
        </View>
      ) : null}
      {selected ? (
        <Pressable
          accessibilityLabel={`Open ${selected.year} ${selected.make} ${selected.model}`}
          accessibilityRole="button"
          onPress={() => onOpen(selected.vehicleId)}
          style={styles.preview}
        >
          <VehicleImage contentPath={selected.coverPhoto?.contentPath} style={styles.image} />
          <View style={styles.previewBody}>
            <Text numberOfLines={1} style={styles.title}>
              {selected.year} {selected.make} {selected.model}
            </Text>
            <Text style={styles.price}>
              {money(selected.displayPrice.amountMinor, selected.currency)} / day
            </Text>
            <Text style={styles.detail}>
              {selected.approximateLocation.city} · about {selected.distanceKm.toFixed(0)} km away
            </Text>
            <View style={styles.badges}>
              {selected.fulfillment.renterPickupAvailable ? <StatusBadge label="Pickup" /> : null}
              {selected.fulfillment.deliveryToSearchLocation === true ? (
                <StatusBadge label="Delivery to your location" />
              ) : selected.fulfillment.ownerDeliveryAvailable ? (
                <StatusBadge label="Delivery" />
              ) : null}
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cluster: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.surface,
    borderRadius: 24,
    borderWidth: 3,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  clusterText: { color: colors.surface, fontSize: 16, fontWeight: '900' },
  detail: { color: colors.subtleText, fontSize: 12 },
  image: { borderRadius: radius.md, height: 88, width: 110 },
  message: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    bottom: 130,
    gap: spacing.xs,
    padding: spacing.md,
    position: 'absolute',
    width: '88%',
  },
  messageCopy: { color: colors.subtleText, lineHeight: 19 },
  messageTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  preview: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    bottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
    left: spacing.md,
    padding: spacing.sm,
    position: 'absolute',
    right: spacing.md,
  },
  previewBody: { flex: 1, gap: 3 },
  price: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  pricePin: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    borderWidth: 2,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pricePinSelected: { borderColor: colors.ink, borderWidth: 4, transform: [{ scale: 1.12 }] },
  pricePinText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  pricePinTextSelected: { color: colors.ink },
  privacy: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    color: colors.subtleText,
    fontSize: 11,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  root: { flex: 1, minHeight: 360, overflow: 'hidden' },
  searchArea: { alignSelf: 'center', marginTop: spacing.xl, position: 'absolute' },
  title: { color: colors.ink, fontSize: 16, fontWeight: '800' },
});
