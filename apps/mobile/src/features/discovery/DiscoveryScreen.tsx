import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import type { BookingView } from '../bookings/MyBookingsScreen';

interface VehicleCard {
  readonly vehicleId: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly distanceKm: number;
  readonly favorite: boolean;
  readonly approximateLocation: { city: string; province: string };
  readonly displayPrice: { amountMinor: number; label: string };
  readonly currency: string;
  readonly availability: { available: boolean; warning: string };
  readonly estimatedRentalTotal?: { amountMinor: number; chargeableDays: number };
}

interface SearchResponse {
  readonly items: readonly VehicleCard[];
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
  readonly transmission: string | null;
  readonly location: { city: string; province: string };
  readonly pricing: { currency: string; dailyRateMinor: number; authoritative: false };
  readonly mileagePolicy: { type: string; includedKilometersPerChargeableDay?: number };
  readonly features: readonly { id: string; name: string }[];
  readonly owner: { displayName: string; verified: boolean };
}

interface Quote {
  readonly id: string;
  readonly vehicleId: string;
  readonly chargeableDays: number;
  readonly currency: string;
  readonly totalMinor: number;
  readonly includedMileageKm: number | null;
  readonly expiresAt: string;
  readonly pricingEngineVersion: string;
  readonly reservesVehicle: false;
  readonly lines: readonly {
    code: string;
    description: string;
    amountMinor: number;
  }[];
}

type ViewMode = 'search' | 'results' | 'detail' | 'favorites' | 'quote';
const sessionRecentlyViewed: string[] = [];

function tomorrow(hour: number, plusDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + plusDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

export function DiscoveryScreen({ home = false }: { readonly home?: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ViewMode>(home ? 'results' : 'search');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [latitude, setLatitude] = useState('13.9414');
  const [longitude, setLongitude] = useState('121.6230');
  const [radius, setRadius] = useState('25');
  const [start, setStart] = useState(tomorrow(9, 1));
  const [end, setEnd] = useState(tomorrow(9, 2));
  const [make, setMake] = useState('');
  const [seats, setSeats] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [, setRecentVersion] = useState(0);
  const [searched, setSearched] = useState(home);
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ latitude, longitude, radius, sort: 'RECOMMENDED' });
    if (!home || searched) {
      query.set('start', start);
      query.set('end', end);
    }
    if (make) query.set('make', make);
    if (seats) query.set('seats', seats);
    return query.toString();
  }, [end, home, latitude, longitude, make, radius, searched, seats, start]);
  const search = useQuery({
    enabled: searched || home,
    queryKey: ['public-search', queryString],
    queryFn: () => apiClient.request<SearchResponse>(`/vehicles/search?${queryString}`),
  });
  const detail = useQuery({
    enabled: Boolean(vehicleId) && (mode === 'detail' || mode === 'quote'),
    queryKey: ['public-vehicle', vehicleId],
    queryFn: () => apiClient.request<VehicleDetail>(`/vehicles/${vehicleId}`),
  });
  const favorites = useQuery({
    enabled: mode === 'favorites',
    queryKey: ['favorites'],
    queryFn: () =>
      apiClient.request<{
        items: readonly { vehicle: VehicleDetail }[];
        unavailableCount: number;
      }>('/favorites'),
  });
  const favorite = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.request(`/favorites/${id}`, { method: active ? 'DELETE' : 'PUT' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      void queryClient.invalidateQueries({ queryKey: ['public-search'] });
      void queryClient.invalidateQueries({ queryKey: ['public-vehicle'] });
    },
  });
  const quote = useMutation({
    mutationFn: () =>
      apiClient.request<Quote>(`/vehicles/${vehicleId}/quotes`, {
        body: JSON.stringify({ end, start }),
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
    mutationFn: (reference: string) =>
      apiClient.request<BookingView>(`/bookings/${reference}/continue`, { method: 'POST' }),
  });

  const openVehicle = (id: string) => {
    const previous = sessionRecentlyViewed.indexOf(id);
    if (previous >= 0) sessionRecentlyViewed.splice(previous, 1);
    sessionRecentlyViewed.unshift(id);
    sessionRecentlyViewed.splice(10);
    setRecentVersion((value) => value + 1);
    setVehicleId(id);
    setMode('detail');
  };

  if (mode === 'favorites') {
    return (
      <Page title="Favorites" back={() => setMode(home ? 'results' : 'search')}>
        {favorites.isError && <State text="We couldn't load favorites. Check your connection." />}
        {favorites.data?.unavailableCount ? (
          <Text style={styles.note}>
            {favorites.data.unavailableCount} saved vehicle(s) are currently unavailable and hidden.
          </Text>
        ) : null}
        {favorites.data?.items.length === 0 && <State text="No favorites yet." />}
        {favorites.data?.items.map(({ vehicle }) => (
          <Pressable
            key={vehicle.vehicleId}
            style={styles.card}
            onPress={() => openVehicle(vehicle.vehicleId)}
          >
            <Text style={styles.cardTitle}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Text>
            <Text style={styles.body}>
              {vehicle.location.city}, {vehicle.location.province}
            </Text>
          </Pressable>
        ))}
      </Page>
    );
  }

  if ((mode === 'detail' || mode === 'quote') && detail.data) {
    const vehicle = detail.data;
    return (
      <Page
        title={`${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim()}
        back={() => setMode('results')}
      >
        <Text style={styles.eyebrow}>
          {vehicle.year} · {vehicle.transmission} · {vehicle.seats} seats
        </Text>
        <Text style={styles.body}>
          {vehicle.location.city}, {vehicle.location.province}
        </Text>
        <Text style={styles.price}>From {money(vehicle.pricing.dailyRateMinor)} / day</Text>
        <Text style={styles.body}>{vehicle.description ?? 'No description supplied.'}</Text>
        <Text style={styles.heading}>Features</Text>
        <Text style={styles.body}>
          {vehicle.features.map(({ name }) => name).join(' · ') || 'No features listed'}
        </Text>
        <Text style={styles.heading}>Mileage</Text>
        <Text style={styles.body}>
          {vehicle.mileagePolicy.type === 'UNLIMITED'
            ? 'Unlimited mileage'
            : `${vehicle.mileagePolicy.includedKilometersPerChargeableDay} km per chargeable day`}
        </Text>
        <Text style={styles.heading}>Owner</Text>
        <Text style={styles.body}>{vehicle.owner.displayName} · Verified owner</Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => favorite.mutate({ active: vehicle.favorite, id: vehicle.vehicleId })}
        >
          <Text style={styles.secondaryText}>
            {vehicle.favorite ? 'Remove favorite' : 'Add to favorites'}
          </Text>
        </Pressable>
        <Text style={styles.heading}>Date and time</Text>
        <Field label="Pickup (ISO timestamp)" value={start} onChange={setStart} />
        <Field label="Return (ISO timestamp)" value={end} onChange={setEnd} />
        <Text style={styles.note}>A quote does not reserve the vehicle.</Text>
        <Pressable style={styles.button} onPress={() => quote.mutate()}>
          <Text style={styles.buttonText}>
            {quote.isPending ? 'Checking…' : 'Get authoritative quote'}
          </Text>
        </Pressable>
        {quote.isError && <State text={quote.error.message} />}
        {mode === 'quote' && quote.data && (
          <View style={styles.quote}>
            <Text style={styles.heading}>Pricing quote</Text>
            {quote.data.lines.map((line) => (
              <View key={line.code} style={styles.line}>
                <Text style={styles.body}>{line.description}</Text>
                <Text style={styles.cardTitle}>{money(line.amountMinor)}</Text>
              </View>
            ))}
            <Text style={styles.price}>Total {money(quote.data.totalMinor)}</Text>
            <Text style={styles.body}>Chargeable days: {quote.data.chargeableDays}</Text>
            <Text style={styles.body}>
              Included mileage: {quote.data.includedMileageKm ?? 'Unlimited'} km
            </Text>
            <Text style={styles.note}>
              Valid until {new Date(quote.data.expiresAt).toLocaleString()}. This is not a
              reservation.
            </Text>
            {!reserve.data && (
              <Pressable style={styles.button} onPress={() => reserve.mutate(quote.data.id)}>
                <Text style={styles.buttonText}>
                  {reserve.isPending ? 'Creating hold…' : 'Reserve for 10 minutes'}
                </Text>
              </Pressable>
            )}
            {reserve.isError && <State text={reserve.error.message} />}
            {reserve.data && (
              <View style={styles.notice}>
                <Text style={styles.cardTitle}>{reserve.data.publicReference}</Text>
                <Text style={styles.body}>Vehicle held temporarily</Text>
                <Text style={styles.note}>
                  No payment has been authorized. Hold expires{' '}
                  {reserve.data.holdExpiresAt
                    ? new Date(reserve.data.holdExpiresAt).toLocaleString()
                    : 'soon'}
                  .
                </Text>
                {!continueBooking.data && (
                  <Pressable
                    style={styles.button}
                    onPress={() => continueBooking.mutate(reserve.data!.publicReference)}
                  >
                    <Text style={styles.buttonText}>Continue</Text>
                  </Pressable>
                )}
                {continueBooking.data && (
                  <Text style={styles.note}>
                    Awaiting payment setup. Phase 5 has not charged or authorized payment.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </Page>
    );
  }

  return (
    <Page title={home ? 'Find your next drive' : 'Search vehicles'}>
      <Text style={styles.body}>
        Search approved cars near you. Exact vehicle locations remain private.
      </Text>
      <View style={styles.shortcuts}>
        <Pressable style={styles.secondaryButton} onPress={() => setMode('favorites')}>
          <Text style={styles.secondaryText}>Favorites</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => setFiltersVisible((value) => !value)}
        >
          <Text style={styles.secondaryText}>Filters</Text>
        </Pressable>
      </View>
      <Text style={styles.heading}>Location and dates</Text>
      <Field label="Latitude" value={latitude} onChange={setLatitude} />
      <Field label="Longitude" value={longitude} onChange={setLongitude} />
      <View style={styles.radiusRow}>
        {['5', '10', '25', '50', '100'].map((value) => (
          <Pressable
            key={value}
            style={[styles.pill, radius === value && styles.pillActive]}
            onPress={() => setRadius(value)}
          >
            <Text style={radius === value ? styles.pillTextActive : styles.pillText}>
              {value} km
            </Text>
          </Pressable>
        ))}
      </View>
      <Field label="Pickup (ISO timestamp)" value={start} onChange={setStart} />
      <Field label="Return (ISO timestamp)" value={end} onChange={setEnd} />
      {filtersVisible && (
        <View style={styles.filters}>
          <Field label="Make" value={make} onChange={setMake} />
          <Field label="Minimum seats" value={seats} onChange={setSeats} />
          <Text style={styles.note}>
            More category, powertrain, price, mileage, and feature filters are supported by the API.
          </Text>
        </View>
      )}
      <Pressable
        style={styles.button}
        onPress={() => {
          setSearched(true);
          setMode('results');
          void search.refetch();
        }}
      >
        <Text style={styles.buttonText}>Search</Text>
      </Pressable>
      {(searched || home) && (
        <View>
          {home && sessionRecentlyViewed.length > 0 && (
            <View>
              <Text style={styles.heading}>Recently viewed</Text>
              {sessionRecentlyViewed.flatMap((id) => {
                const vehicle = search.data?.items.find((item) => item.vehicleId === id);
                return vehicle
                  ? [
                      <Pressable key={id} style={styles.card} onPress={() => openVehicle(id)}>
                        <Text style={styles.cardTitle}>
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </Text>
                        <Text style={styles.body}>
                          {vehicle.approximateLocation.city}, {vehicle.approximateLocation.province}
                        </Text>
                      </Pressable>,
                    ]
                  : [];
              })}
            </View>
          )}
          <Text style={styles.heading}>{home ? 'Nearby cars' : 'Search results'}</Text>
          {search.isPending && <State text="Finding available vehicles…" />}
          {search.isError && <State text={search.error.message} />}
          {search.data?.items.length === 0 && (
            <State text="No vehicles match this area, date range, and filters." />
          )}
          {search.data?.items.map((vehicle) => (
            <Pressable
              key={vehicle.vehicleId}
              style={styles.card}
              onPress={() => openVehicle(vehicle.vehicleId)}
            >
              <View style={styles.line}>
                <View>
                  <Text style={styles.cardTitle}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </Text>
                  <Text style={styles.body}>
                    {vehicle.approximateLocation.city}, {vehicle.approximateLocation.province}
                  </Text>
                  <Text style={styles.body}>
                    Approximately {vehicle.distanceKm.toFixed(1)} km away
                  </Text>
                </View>
                <Text style={styles.cardTitle}>{money(vehicle.displayPrice.amountMinor)}/day</Text>
              </View>
              {vehicle.estimatedRentalTotal && (
                <Text style={styles.note}>
                  Estimated {money(vehicle.estimatedRentalTotal.amountMinor)} · Get a quote for an
                  authoritative price
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </Page>
  );
}

function Page({
  title,
  back,
  children,
}: {
  readonly title: string;
  readonly back?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {back && (
        <Pressable onPress={back}>
          <Text style={styles.link}>← Back</Text>
        </Pressable>
      )}
      <Text style={styles.title}>{title}</Text>
      {children}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput autoCapitalize="none" style={styles.input} value={value} onChangeText={onChange} />
    </View>
  );
}

function State({ text }: { readonly text: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

function money(minor: number): string {
  return `₱${(minor / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '700' },
  eyebrow: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  field: { marginTop: spacing.md },
  filters: {
    backgroundColor: colors.muted,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.xl },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  link: { color: colors.primary, fontWeight: '700', marginBottom: spacing.md },
  note: { color: colors.subtleText, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  notice: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  pill: {
    backgroundColor: colors.muted,
    borderRadius: 20,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pillActive: { backgroundColor: colors.primary },
  pillText: { color: colors.ink, fontSize: 12 },
  pillTextActive: { color: colors.onPrimary, fontSize: 12 },
  price: { color: colors.ink, fontSize: 22, fontWeight: '800', marginTop: spacing.lg },
  quote: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  secondaryButton: {
    borderColor: colors.primary,
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.sm,
  },
  secondaryText: { color: colors.primary, fontWeight: '700' },
  shortcuts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  state: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
