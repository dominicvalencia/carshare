import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { developmentLocationSuggestions } from '../../location/location-provider';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import { domainLabel, money, vehicleStatusLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { BackControl, StateView, StatusBadge } from '../../ui/primitives';

interface Reference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly required?: boolean;
}
interface SafeFile {
  readonly id: string;
  readonly originalName: string;
  readonly contentGrant?: { readonly contentPath: string } | null;
}
interface VehiclePhoto {
  readonly id: string;
  readonly perspective: string;
  readonly displayOrder: number;
  readonly isCover: boolean;
  readonly fileAsset: SafeFile;
}
interface VehicleDocument {
  readonly id: string;
  readonly definitionId: string;
  readonly definition: Reference;
  readonly replacedAt: string | null;
}
interface Policy {
  readonly version: number;
  readonly dailyRateMinor: number;
  readonly mileagePolicy: string;
  readonly turnaroundMinutes: number;
}
interface Vehicle {
  readonly id: string;
  readonly status: string;
  readonly operationalStatus: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly variant: string | null;
  readonly transmission: string | null;
  readonly fuelType: string | null;
  readonly seatCount: number | null;
  readonly doorCount: number | null;
  readonly color: string | null;
  readonly plateNumber: string | null;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly powertrain: string | null;
  readonly reviewReason: string | null;
  readonly features: Array<{ readonly featureId: string }>;
  readonly photos: VehiclePhoto[];
  readonly documents: VehicleDocument[];
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly city: string;
    readonly province: string;
    readonly pickupAreaLabel: string | null;
  } | null;
  readonly policyVersions: Policy[];
}

const steps = [
  'Details',
  'Features',
  'Photos',
  'Documents',
  'Location',
  'Policies',
  'Availability',
  'Review',
] as const;
const perspectives = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR_DASHBOARD',
] as const;

export function VehiclesScreen() {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiClient.request<Vehicle[]>('/owner/vehicles'),
  });
  const create = useMutation({
    mutationFn: () => apiClient.request<Vehicle>('/owner/vehicles', { body: '{}', method: 'POST' }),
    onSuccess: (vehicle) => {
      setSelectedId(vehicle.id);
      void client.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
  if (selectedId)
    return (
      <VehicleEditor
        id={selectedId}
        onClose={() => {
          setSelectedId(null);
          void client.invalidateQueries({ queryKey: ['vehicles'] });
        }}
      />
    );
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>OWNER FLEET</Text>
        <Text style={styles.title}>My vehicles</Text>
        <Text style={styles.body}>
          Drafts save on the server, so you can leave and resume at any time.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => create.mutate()}>
          <Text style={styles.primaryText}>Add vehicle</Text>
        </Pressable>
        {create.error && <Text style={styles.error}>{create.error.message}</Text>}
        {vehicles.isPending && <StateView loading title="Loading your fleet…" />}
        {vehicles.isError && (
          <StateView
            icon="cloud-offline-outline"
            title="Fleet unavailable"
            message={vehicles.error.message}
            actionLabel="Retry"
            onAction={() => void vehicles.refetch()}
          />
        )}
        {vehicles.data?.map((vehicle) => (
          <Pressable
            key={vehicle.id}
            accessibilityRole="button"
            onPress={() => setSelectedId(vehicle.id)}
            style={styles.fleetCard}
          >
            <VehicleImage
              contentPath={vehicle.photos[0]?.fileAsset.contentGrant?.contentPath}
              style={styles.fleetImage}
            />
            <View style={styles.fleetContent}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {vehicle.make && vehicle.model
                  ? `${vehicle.modelYear ?? ''} ${vehicle.make} ${vehicle.model}`.trim()
                  : 'Untitled vehicle draft'}
              </Text>
              <StatusBadge
                label={vehicleStatusLabel(vehicle.status)}
                tone={vehicleTone(vehicle.status)}
              />
              <Text style={styles.body}>{vehicleStatusLabel(vehicle.operationalStatus)}</Text>
              {vehicle.location && (
                <Text numberOfLines={1} style={styles.body}>
                  {vehicle.location.city}, {vehicle.location.province}
                </Text>
              )}
              {vehicle.policyVersions[0] && (
                <Text style={styles.rate}>
                  {money(vehicle.policyVersions[0].dailyRateMinor)} / day
                </Text>
              )}
              {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
              <Text style={styles.link}>Manage vehicle →</Text>
            </View>
          </Pressable>
        ))}
        {!vehicles.isPending && !vehicles.isError && vehicles.data?.length === 0 && (
          <StateView
            icon="car-sport-outline"
            title="No vehicles yet"
            message="Add a vehicle to start a draft. You can finish it before owner verification is complete."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VehicleEditor({ id, onClose }: { readonly id: string; readonly onClose: () => void }) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(`/owner/vehicles/${id}`),
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ['vehicle', id] });
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = 'POST',
    }: {
      path: string;
      body?: object;
      method?: string;
    }) =>
      apiClient.request(`/owner/vehicles/${id}${path}`, {
        ...(body ? { body: JSON.stringify(body) } : {}),
        method,
      }),
    onSuccess: refresh,
  });
  if (vehicle.isPending)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.editorStateHeader}>
          <BackControl label="Fleet" onPress={onClose} />
        </View>
        <StateView loading title="Loading vehicle draft…" />
      </SafeAreaView>
    );
  if (vehicle.isError || !vehicle.data)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.editorStateHeader}>
          <BackControl label="Fleet" onPress={onClose} />
        </View>
        <StateView
          icon="cloud-offline-outline"
          title="Vehicle unavailable"
          message={vehicle.error?.message}
          actionLabel="Retry"
          onAction={() => void vehicle.refetch()}
        />
      </SafeAreaView>
    );
  const value = vehicle.data;
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={styles.editorHeader}>
        <BackControl label="Fleet" onPress={onClose} />
        <View>
          <Text style={styles.cardTitle}>
            {value.make ?? 'Vehicle'} {value.model ?? 'draft'}
          </Text>
          <Text style={styles.body}>{vehicleStatusLabel(value.status)}</Text>
        </View>
      </View>
      <View
        style={styles.progressPanel}
        accessibilityLabel={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}
      >
        <View style={styles.progressCopy}>
          <Text style={styles.progressStep}>
            Step {step + 1} of {steps.length}
          </Text>
          <Text style={styles.progressTitle}>{steps[step]}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.editorBody}>
        {step === 0 && <DetailsStep vehicle={value} onSaved={refresh} />}
        {step === 1 && (
          <FeaturesStep
            id={id}
            selectedFeatureIds={value.features.map((item) => item.featureId)}
            onSaved={refresh}
          />
        )}
        {step === 2 && <PhotosStep id={id} photos={value.photos} onSaved={refresh} />}
        {step === 3 && <DocumentsStep id={id} documents={value.documents} onSaved={refresh} />}
        {step === 4 && <LocationStep id={id} vehicle={value} onSaved={refresh} />}
        {step === 5 && <PolicyStep id={id} vehicle={value} onSaved={refresh} />}
        {step === 6 && <AvailabilityStep id={id} vehicle={value} onSaved={refresh} />}
        {step === 7 && <ReviewStep vehicle={value} action={action.mutate} />}
        {action.error && <Text style={styles.error}>{action.error.message}</Text>}
      </ScrollView>
      <View style={styles.editorActions}>
        {step > 0 && (
          <Pressable
            accessibilityRole="button"
            style={[styles.secondaryButton, styles.editorActionButton]}
            onPress={() => setStep(step - 1)}
          >
            <Text>Previous</Text>
          </Pressable>
        )}
        {step < steps.length - 1 && (
          <Pressable
            accessibilityRole="button"
            style={[styles.primaryButton, styles.editorActionButton]}
            onPress={() => setStep(step + 1)}
          >
            <Text style={styles.primaryText}>Continue</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function DetailsStep({
  vehicle,
  onSaved,
}: {
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const categories = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/categories'),
  });
  const [form, setForm] = useState({
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    modelYear: vehicle.modelYear?.toString() ?? '',
    categoryId: vehicle.categoryId ?? '',
    variant: vehicle.variant ?? '',
    transmission: vehicle.transmission ?? 'AUTOMATIC',
    powertrain: vehicle.powertrain ?? 'ICE',
    fuelType:
      vehicle.fuelType ?? (vehicle.powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE'),
    seatCount: vehicle.seatCount?.toString() ?? '5',
    doorCount: vehicle.doorCount?.toString() ?? '4',
    color: vehicle.color ?? '',
    plateNumber: vehicle.plateNumber ?? '',
    description: vehicle.description ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${vehicle.id}`, {
        body: JSON.stringify({
          ...form,
          modelYear: Number(form.modelYear),
          seatCount: Number(form.seatCount),
          doorCount: Number(form.doorCount),
        }),
        method: 'PATCH',
      }),
    onSuccess: onSaved,
  });
  return (
    <Section title="Basic details">
      <Field label="Make" value={form.make} onChange={(make) => setForm({ ...form, make })} />
      <Field label="Model" value={form.model} onChange={(model) => setForm({ ...form, model })} />
      <Field
        label="Model year"
        value={form.modelYear}
        onChange={(modelYear) => setForm({ ...form, modelYear })}
        keyboard="numeric"
      />
      <Text style={styles.label}>Body category</Text>
      <View style={styles.wrap}>
        {categories.data?.map((category) => (
          <Choice
            key={category.id}
            selected={form.categoryId === category.id}
            label={category.name}
            onPress={() => setForm({ ...form, categoryId: category.id })}
          />
        ))}
      </View>
      <Text style={styles.label}>Powertrain</Text>
      <View style={styles.wrap}>
        {['ICE', 'HYBRID', 'PLUG_IN_HYBRID', 'BATTERY_ELECTRIC'].map((powertrain) => (
          <Choice
            key={powertrain}
            selected={form.powertrain === powertrain}
            label={domainLabel(powertrain)}
            onPress={() =>
              setForm({
                ...form,
                powertrain,
                fuelType: powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE',
              })
            }
          />
        ))}
      </View>
      <Field label="Color" value={form.color} onChange={(color) => setForm({ ...form, color })} />
      <Field
        label="Plate number (private)"
        value={form.plateNumber}
        onChange={(plateNumber) => setForm({ ...form, plateNumber })}
      />
      <Field
        label="Description"
        value={form.description}
        onChange={(description) => setForm({ ...form, description })}
      />
      <Save mutation={save} />
    </Section>
  );
}

function FeaturesStep({
  id,
  selectedFeatureIds,
  onSaved,
}: {
  readonly id: string;
  readonly selectedFeatureIds: string[];
  readonly onSaved: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-features'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/features'),
  });
  const [selected, setSelected] = useState<string[]>(selectedFeatureIds);
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/features`, {
        body: JSON.stringify({ featureIds: selected }),
        method: 'PUT',
      }),
    onSuccess: onSaved,
  });
  return (
    <Section title="Features">
      <Text style={styles.body}>Choose structured features renters can filter later.</Text>
      <View style={styles.wrap}>
        {definitions.data?.map((feature) => (
          <Choice
            key={feature.id}
            selected={selected.includes(feature.id)}
            label={feature.name}
            onPress={() =>
              setSelected(
                selected.includes(feature.id)
                  ? selected.filter((item) => item !== feature.id)
                  : [...selected, feature.id],
              )
            }
          />
        ))}
      </View>
      <Save mutation={save} />
    </Section>
  );
}

function PhotosStep({
  id,
  photos,
  onSaved,
}: {
  readonly id: string;
  readonly photos: VehiclePhoto[];
  readonly onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const upload = async (perspective: string) => {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'PRIVATE', {
        uri: asset.uri,
        name: asset.fileName ?? `${perspective}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      const displayOrder = Math.max(-1, ...photos.map((photo) => photo.displayOrder)) + 1;
      await apiClient.request(`/owner/vehicles/${id}/photos`, {
        body: JSON.stringify({
          fileAssetId: file.id,
          perspective,
          displayOrder,
          isCover: photos.length === 0,
        }),
        method: 'POST',
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    }
  };
  const remove = async (photoId: string) => {
    try {
      await apiClient.request(`/owner/vehicles/${id}/photos/${photoId}`, { method: 'DELETE' });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Removal failed.');
    }
  };
  return (
    <Section title="Vehicle photos">
      <Text style={styles.body}>
        Minimum: front, rear, both sides, and dashboard/interior. The first photo becomes the cover.
      </Text>
      {perspectives.map((perspective) => {
        const present = photos.find((photo) => photo.perspective === perspective);
        return (
          <View key={perspective} style={styles.card}>
            <Pressable disabled={Boolean(present)} onPress={() => void upload(perspective)}>
              <Text style={styles.cardTitle}>
                {present ? '✓' : '+'} {domainLabel(perspective)}
              </Text>
              <Text style={styles.body}>
                {present
                  ? `${present.fileAsset.originalName}${present.isCover ? ' · cover' : ''}`
                  : 'Choose image'}
              </Text>
            </Pressable>
            {present && (
              <Pressable onPress={() => void remove(present.id)}>
                <Text style={styles.error}>Remove / replace</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

function DocumentsStep({
  id,
  documents,
  onSaved,
}: {
  readonly id: string;
  readonly documents: VehicleDocument[];
  readonly onSaved: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-documents'],
    queryFn: () =>
      apiClient.request<Reference[]>('/owner/vehicle-reference-data/document-definitions'),
  });
  const [error, setError] = useState('');
  const upload = async (definition: Reference) => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['application/pdf', 'image/*'],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'SENSITIVE', {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      });
      const current = documents.find(
        (document) => document.definitionId === definition.id && !document.replacedAt,
      );
      await apiClient.request(`/owner/vehicles/${id}/documents`, {
        body: JSON.stringify({
          definitionId: definition.id,
          fileAssetId: file.id,
          ...(current ? { replacesDocumentId: current.id } : {}),
        }),
        method: 'POST',
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    }
  };
  return (
    <Section title="Verification documents">
      <Text style={styles.body}>
        Files remain sensitive and are only available through expiring authorized access.
      </Text>
      {definitions.data?.map((definition) => {
        const present = documents.some(
          (document) => document.definitionId === definition.id && !document.replacedAt,
        );
        return (
          <Pressable
            key={definition.id}
            style={styles.card}
            onPress={() => void upload(definition)}
          >
            <Text style={styles.cardTitle}>
              {present ? '✓' : '+'} {definition.name}
            </Text>
            <Text style={styles.body}>
              {definition.required ? 'Required' : 'If applicable'} ·{' '}
              {present ? 'Replace document' : 'Choose file'}
            </Text>
          </Pressable>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

function LocationStep({
  id,
  vehicle,
  onSaved,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const [form, setForm] = useState({
    latitude: vehicle.location?.latitude ?? '14.5547',
    longitude: vehicle.location?.longitude ?? '121.0244',
    city: vehicle.location?.city ?? '',
    province: vehicle.location?.province ?? 'Metro Manila',
    pickupAreaLabel: vehicle.location?.pickupAreaLabel ?? '',
  });
  const [locationError, setLocationError] = useState('');
  const areas = developmentLocationSuggestions;
  const captureDeviceLocation = async () => {
    setLocationError('');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocationError('Location access was not granted. Choose a pickup city instead.');
      return;
    }
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm({
        ...form,
        latitude: String(current.coords.latitude),
        longitude: String(current.coords.longitude),
      });
    } catch {
      setLocationError('We could not capture this location. Try again or choose a city.');
    }
  };
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/location`, {
        body: JSON.stringify(form),
        method: 'PUT',
      }),
    onSuccess: onSaved,
  });
  return (
    <Section title="Private pickup location">
      <Text style={styles.body}>
        Renters see only the city and province. Choose the nearest area, then use your device at the
        private pickup point for accurate distance.
      </Text>
      <Text style={styles.label}>Pickup city</Text>
      <View style={styles.wrap}>
        {areas.map((area) => (
          <Choice
            key={area.city}
            label={area.city}
            selected={form.city === area.city}
            onPress={() =>
              setForm({
                ...form,
                city: area.city,
                province: area.province,
                latitude: String(area.latitude),
                longitude: String(area.longitude),
              })
            }
          />
        ))}
      </View>
      <Pressable style={styles.secondaryButton} onPress={() => void captureDeviceLocation()}>
        <Text>Use this device at the pickup point</Text>
      </Pressable>
      {locationError && <Text style={styles.error}>{locationError}</Text>}
      <Field label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
      <Field
        label="Province / region"
        value={form.province}
        onChange={(province) => setForm({ ...form, province })}
      />
      <Field
        label="Pickup area label (optional)"
        value={form.pickupAreaLabel}
        onChange={(pickupAreaLabel) => setForm({ ...form, pickupAreaLabel })}
      />
      <Save mutation={save} />
    </Section>
  );
}

function PolicyStep({
  id,
  vehicle,
  onSaved,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const [dailyRate, setDailyRate] = useState(
    current ? String(current.dailyRateMinor / 100) : '2500',
  );
  const [limited, setLimited] = useState(current?.mileagePolicy !== 'UNLIMITED');
  const [included, setIncluded] = useState('150');
  const [excess, setExcess] = useState('15');
  const [turnaround, setTurnaround] = useState(current?.turnaroundMinutes ?? 120);
  const electric = vehicle.powertrain === 'BATTERY_ELECTRIC';
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/policy-versions`, {
        body: JSON.stringify({
          dailyRateMinor: Math.round(Number(dailyRate) * 100),
          minimumRentalDays: 1,
          maximumRentalDays: 30,
          mileagePolicy: limited ? 'LIMITED' : 'UNLIMITED',
          ...(limited
            ? {
                includedKilometersPerDay: Number(included),
                excessKilometerRateMinor: Math.round(Number(excess) * 100),
              }
            : {}),
          ...(electric
            ? { evReturnPolicy: 'SAME_TO_SAME', evTolerancePercent: 5 }
            : { fuelReturnPolicy: 'SAME_TO_SAME', fuelTolerancePercent: 5 }),
          turnaroundMinutes: turnaround,
          availabilityPolicy: 'EVERY_DAY',
        }),
        method: 'POST',
      }),
    onSuccess: onSaved,
  });
  return (
    <Section title="Pricing and usage policies">
      <Field
        label="Daily rate (PHP)"
        value={dailyRate}
        onChange={setDailyRate}
        keyboard="numeric"
      />
      <Text style={styles.label}>Mileage</Text>
      <View style={styles.wrap}>
        <Choice label="150 km/day" selected={limited} onPress={() => setLimited(true)} />
        <Choice label="Unlimited" selected={!limited} onPress={() => setLimited(false)} />
      </View>
      {limited && (
        <>
          <Field
            label="Included km per chargeable day"
            value={included}
            onChange={setIncluded}
            keyboard="numeric"
          />
          <Field
            label="Excess charge per whole km (PHP)"
            value={excess}
            onChange={setExcess}
            keyboard="numeric"
          />
        </>
      )}
      <Text style={styles.label}>Turnaround buffer</Text>
      <View style={styles.wrap}>
        {[120, 240, 360, 720, 1440].map((minutes) => (
          <Choice
            key={minutes}
            selected={turnaround === minutes}
            label={`${minutes / 60}h`}
            onPress={() => setTurnaround(minutes)}
          />
        ))}
      </View>
      <Text style={styles.body}>
        {electric ? 'EV same-to-same, 5% tolerance' : 'Fuel same-to-same, 5% tolerance'} ·
        deficiency charges require platform review. Current rate:{' '}
        {money(Math.round(Number(dailyRate || 0) * 100))} per day.
      </Text>
      <Save mutation={save} />
    </Section>
  );
}

function AvailabilityStep({
  id,
  vehicle,
  onSaved,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const [startsAt, setStartsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    value.setHours(9, 0, 0, 0);
    return value;
  });
  const [endsAt, setEndsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 2);
    value.setHours(9, 0, 0, 0);
    return value;
  });
  const add = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/blocked-periods`, {
        body: JSON.stringify({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          reason: 'PERSONAL_USE',
        }),
        method: 'POST',
      }),
    onSuccess: onSaved,
  });
  return (
    <Section title="Availability">
      <Text style={styles.body}>
        Current weekly policy: every day. Whole-day rules are versioned; pickup time windows arrive
        with booking scheduling.
      </Text>
      <Text style={styles.body}>
        Current preparation buffer: {(current?.turnaroundMinutes ?? 120) / 60} hours between
        rentals.
      </Text>
      <Text style={styles.label}>Block a future period</Text>
      <DateTimeField
        label="Starts"
        value={startsAt}
        minimumDate={new Date()}
        onChange={setStartsAt}
      />
      <DateTimeField label="Ends" value={endsAt} minimumDate={startsAt} onChange={setEndsAt} />
      {endsAt <= startsAt && <Text style={styles.error}>End must be after start.</Text>}
      <Save mutation={add} label="Add blocked period" />
    </Section>
  );
}

function ReviewStep({
  vehicle,
  action,
}: {
  readonly vehicle: Vehicle;
  readonly action: (value: { path: string; body?: object; method?: string }) => void;
}) {
  const editable = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(vehicle.status);
  return (
    <Section title="Review and submit">
      <Text style={styles.status}>Status: {vehicleStatusLabel(vehicle.status)}</Text>
      {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
      <View style={styles.reviewSummary}>
        <Text style={styles.cardTitle}>
          {vehicle.modelYear} {vehicle.make} {vehicle.model}
        </Text>
        <Text style={styles.body}>
          {domainLabel(vehicle.transmission)} · {domainLabel(vehicle.powertrain)} ·{' '}
          {vehicle.seatCount ?? '—'} seats
        </Text>
        <Text style={styles.body}>
          {vehicle.location
            ? `${vehicle.location.city}, ${vehicle.location.province}`
            : 'Location not complete'}
        </Text>
        {vehicle.policyVersions[0] && (
          <Text style={styles.body}>
            {money(vehicle.policyVersions[0].dailyRateMinor)} per day ·{' '}
            {vehicle.policyVersions[0].turnaroundMinutes / 60}-hour preparation buffer
          </Text>
        )}
      </View>
      <Readiness
        label="Basic details"
        done={Boolean(vehicle.make && vehicle.model && vehicle.modelYear && vehicle.categoryId)}
      />
      <Readiness label="Five required photos" done={vehicle.photos.length >= 5} />
      <Readiness
        label="Required documents"
        done={vehicle.documents.filter((item) => !item.replacedAt).length >= 3}
      />
      <Readiness label="Private location" done={Boolean(vehicle.location)} />
      <Readiness label="Pricing and policies" done={vehicle.policyVersions.length > 0} />
      {editable && (
        <Pressable style={styles.primaryButton} onPress={() => action({ path: '/submission' })}>
          <Text style={styles.primaryText}>Submit for approval</Text>
        </Pressable>
      )}
      {vehicle.status === 'APPROVED' && (
        <>
          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              action({
                path: '/operational-status',
                body: {
                  status:
                    vehicle.operationalStatus === 'AVAILABLE'
                      ? 'TEMPORARILY_UNAVAILABLE'
                      : 'AVAILABLE',
                },
                method: 'PATCH',
              })
            }
          >
            <Text>
              {vehicle.operationalStatus === 'AVAILABLE'
                ? 'Mark temporarily unavailable'
                : 'Mark available'}
            </Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={() => action({ path: '/archive' })}>
            <Text style={styles.primaryText}>Archive vehicle</Text>
          </Pressable>
        </>
      )}
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  keyboard,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly keyboard?: 'numeric' | 'decimal-pad';
  readonly placeholder?: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        keyboardType={keyboard}
        onChangeText={onChange}
        placeholder={placeholder}
        style={styles.input}
        value={value}
      />
    </View>
  );
}
function Choice({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceActive]}>
      <Text style={selected ? styles.primaryText : styles.body}>{label}</Text>
    </Pressable>
  );
}
function Save({
  mutation,
  label = 'Save draft',
}: {
  readonly mutation: {
    readonly mutate: () => void;
    readonly isPending: boolean;
    readonly error: Error | null;
  };
  readonly label?: string;
}) {
  return (
    <>
      <Pressable
        disabled={mutation.isPending}
        style={styles.primaryButton}
        onPress={() => mutation.mutate()}
      >
        <Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : label}</Text>
      </Pressable>
      {mutation.error && <Text style={styles.error}>{mutation.error.message}</Text>}
    </>
  );
}
function Readiness({ label, done }: { readonly label: string; readonly done: boolean }) {
  return (
    <View style={styles.readiness}>
      <Text style={done ? styles.status : styles.body}>
        {done ? '✓' : '○'} {label}
      </Text>
    </View>
  );
}

function vehicleTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'APPROVED') return 'success';
  if (['CHANGES_REQUIRED', 'PENDING_APPROVAL'].includes(status)) return 'warning';
  if (['REJECTED', 'SUSPENDED'].includes(status)) return 'danger';
  return 'neutral';
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  choice: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#A12626',
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  editorActionButton: { flex: 1, marginTop: 0 },
  editorActions: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  editorBody: { padding: spacing.xl },
  editorHeader: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.md,
  },
  editorStateHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  empty: { color: colors.subtleText, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: '#A12626', marginTop: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  flex: { backgroundColor: colors.background, flex: 1 },
  fleetCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  fleetContent: { flex: 1, minWidth: 0, paddingVertical: spacing.xxs },
  fleetImage: { borderRadius: radius.md, height: 142, width: 116 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  primaryText: { color: colors.onPrimary, fontWeight: '700' },
  progressCopy: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progressFill: { backgroundColor: colors.primary, borderRadius: radius.pill, height: '100%' },
  progressPanel: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  progressStep: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  progressTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  progressTrack: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    height: 6,
    overflow: 'hidden',
  },
  rate: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  readiness: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  reviewSummary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  step: {
    borderRadius: 999,
    marginRight: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stepActive: { backgroundColor: colors.primary },
  stepBar: { backgroundColor: colors.surface, flexGrow: 0 },
  stepContent: { padding: spacing.sm },
  stepTextActive: { color: colors.onPrimary, fontWeight: '700' },
  title: { color: colors.ink, fontSize: 27, fontWeight: '800', marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
});
