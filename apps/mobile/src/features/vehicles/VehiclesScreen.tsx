import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';

interface Reference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly required?: boolean;
}
interface SafeFile {
  readonly id: string;
  readonly originalName: string;
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
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>OWNER FLEET</Text>
      <Text style={styles.title}>My vehicles</Text>
      <Text style={styles.body}>
        Drafts save on the server, so you can leave and resume at any time.
      </Text>
      <Pressable style={styles.primaryButton} onPress={() => create.mutate()}>
        <Text style={styles.primaryText}>Add vehicle</Text>
      </Pressable>
      {create.error && <Text style={styles.error}>{create.error.message}</Text>}
      {vehicles.data?.map((vehicle) => (
        <Pressable key={vehicle.id} onPress={() => setSelectedId(vehicle.id)} style={styles.card}>
          <Text style={styles.cardTitle}>
            {vehicle.make && vehicle.model
              ? `${vehicle.make} ${vehicle.model}`
              : 'Untitled vehicle draft'}
          </Text>
          <Text style={styles.body}>
            {vehicle.status} · {vehicle.operationalStatus}
          </Text>
          {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
          <Text style={styles.link}>Open vehicle →</Text>
        </Pressable>
      ))}
      {!vehicles.isLoading && vehicles.data?.length === 0 && (
        <Text style={styles.empty}>No vehicles yet.</Text>
      )}
    </ScrollView>
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
  if (!vehicle.data)
    return (
      <View style={styles.loading}>
        <Text>Loading vehicle draft…</Text>
      </View>
    );
  const value = vehicle.data;
  return (
    <View style={styles.flex}>
      <View style={styles.editorHeader}>
        <Pressable onPress={onClose}>
          <Text style={styles.link}>‹ Fleet</Text>
        </Pressable>
        <View>
          <Text style={styles.cardTitle}>
            {value.make ?? 'Vehicle'} {value.model ?? 'draft'}
          </Text>
          <Text style={styles.body}>{value.status}</Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stepBar}
        contentContainerStyle={styles.stepContent}
      >
        {steps.map((label, index) => (
          <Pressable
            key={label}
            onPress={() => setStep(index)}
            style={[styles.step, step === index && styles.stepActive]}
          >
            <Text style={step === index ? styles.stepTextActive : styles.body}>
              {index + 1}. {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
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
        <View style={styles.row}>
          {step > 0 && (
            <Pressable style={styles.secondaryButton} onPress={() => setStep(step - 1)}>
              <Text>Previous</Text>
            </Pressable>
          )}
          {step < steps.length - 1 && (
            <Pressable style={styles.primaryButton} onPress={() => setStep(step + 1)}>
              <Text style={styles.primaryText}>Next</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
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
            label={powertrain.replaceAll('_', ' ')}
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
                {present ? '✓' : '+'} {perspective.replaceAll('_', ' ')}
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
    latitude: vehicle.location?.latitude ?? '14.5995',
    longitude: vehicle.location?.longitude ?? '120.9842',
    city: vehicle.location?.city ?? '',
    province: vehicle.location?.province ?? 'Metro Manila',
    pickupAreaLabel: vehicle.location?.pickupAreaLabel ?? '',
  });
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
        Exact coordinates stay private; future search will use an approximate area.
      </Text>
      <Field
        label="Latitude"
        value={form.latitude}
        onChange={(latitude) => setForm({ ...form, latitude })}
        keyboard="decimal-pad"
      />
      <Field
        label="Longitude"
        value={form.longitude}
        onChange={(longitude) => setForm({ ...form, longitude })}
        keyboard="decimal-pad"
      />
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
  const [dailyRate, setDailyRate] = useState('250000');
  const [limited, setLimited] = useState(true);
  const [included, setIncluded] = useState('150');
  const [excess, setExcess] = useState('1500');
  const [turnaround, setTurnaround] = useState(120);
  const electric = vehicle.powertrain === 'BATTERY_ELECTRIC';
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/policy-versions`, {
        body: JSON.stringify({
          dailyRateMinor: Number(dailyRate),
          minimumRentalDays: 1,
          maximumRentalDays: 30,
          mileagePolicy: limited ? 'LIMITED' : 'UNLIMITED',
          ...(limited
            ? {
                includedKilometersPerDay: Number(included),
                excessKilometerRateMinor: Number(excess),
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
      <Text style={styles.body}>Amounts are integer centavos. ₱2,500.00 = 250000.</Text>
      <Field
        label="Daily rate (centavos)"
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
            label="Excess centavos per whole km"
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
        admin-approved deficiency rules
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
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const add = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/blocked-periods`, {
        body: JSON.stringify({ startsAt, endsAt, reason: 'PERSONAL_USE' }),
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
        Policy version {current?.version ?? 'not configured'} · turnaround{' '}
        {current?.turnaroundMinutes ?? 120} minutes
      </Text>
      <Text style={styles.label}>Block a future period (ISO 8601)</Text>
      <Field
        label="Starts at"
        value={startsAt}
        onChange={setStartsAt}
        placeholder="2026-09-01T08:00:00+08:00"
      />
      <Field
        label="Ends at"
        value={endsAt}
        onChange={setEndsAt}
        placeholder="2026-09-02T08:00:00+08:00"
      />
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
      <Text style={styles.status}>Status: {vehicle.status}</Text>
      {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
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
  editorBody: { padding: spacing.xl, paddingBottom: 80 },
  editorHeader: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.md,
  },
  empty: { color: colors.subtleText, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: '#A12626', marginTop: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  flex: { backgroundColor: colors.background, flex: 1 },
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
  readiness: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end', marginTop: spacing.lg },
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
