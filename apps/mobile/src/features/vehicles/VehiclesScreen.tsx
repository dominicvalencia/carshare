import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import { domainLabel, money, vehicleStatusLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { SearchableReferenceSelector } from '../../ui/SearchableReferenceSelector';
import { BackControl, Button, StateView, StatusBadge } from '../../ui/primitives';

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
  readonly fileAsset: SafeFile;
}
interface Policy {
  readonly version: number;
  readonly dailyRateMinor: number;
  readonly mileagePolicy: string;
  readonly turnaroundMinutes: number;
}
interface VehicleBlock {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
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
  readonly category?: Reference | null;
  readonly powertrain: string | null;
  readonly reviewReason: string | null;
  readonly lastCompletedSection: string | null;
  readonly features: Array<{ readonly featureId: string }>;
  readonly photos: VehiclePhoto[];
  readonly documents: VehicleDocument[];
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly city: string;
    readonly province: string;
    readonly pickupAreaLabel: string | null;
    readonly regionCode: string | null;
    readonly addressScopeCode: string | null;
    readonly provinceCode: string | null;
    readonly cityMunicipalityCode: string | null;
    readonly barangayCode: string | null;
    readonly barangay: string | null;
    readonly addressLine1: string | null;
    readonly landmark: string | null;
  } | null;
  readonly policyVersions: Policy[];
}

interface AreaResponse {
  readonly datasetVersion: string | null;
  readonly items: ReadonlyArray<{
    readonly code: string;
    readonly name: string;
    readonly kind?: string;
    readonly provinceCode?: string | null;
  }>;
}

const steps = [
  'Details',
  'Features',
  'Photos',
  'Documents',
  'Location',
  'Policies',
  'Review',
] as const;
const transitionalVehicleStatuses = ['DRAFT', 'SUBMITTED', 'AWAITING_REVIEW', 'UNDER_REVIEW'];
const perspectives = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR_DASHBOARD',
  'INTERIOR',
  'DASHBOARD',
  'CARGO',
  'ADDITIONAL',
] as const;

export function VehiclesScreen() {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiClient.request<Vehicle[]>('/owner/vehicles'),
    refetchInterval: (query) =>
      query.state.data?.some((vehicle) => transitionalVehicleStatuses.includes(vehicle.status))
        ? 5_000
        : false,
    refetchOnWindowFocus: true,
  });
  const create = useMutation({
    mutationFn: () => apiClient.request<Vehicle>('/owner/vehicles', { body: '{}', method: 'POST' }),
    onSuccess: (vehicle) => {
      setSelectedId(vehicle.id);
      setEditing(true);
      void client.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
  if (selectedId && !editing)
    return (
      <VehicleDetail
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={() => setEditing(true)}
      />
    );
  if (selectedId)
    return (
      <VehicleEditor
        id={selectedId}
        onClose={() => {
          setEditing(false);
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
              {vehicle.category && <Text style={styles.body}>{vehicle.category.name}</Text>}
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

function VehicleDetail({
  id,
  onClose,
  onEdit,
}: {
  readonly id: string;
  readonly onClose: () => void;
  readonly onEdit: () => void;
}) {
  const [managingAvailability, setManagingAvailability] = useState(false);
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(`/owner/vehicles/${id}`),
    refetchInterval: (query) =>
      transitionalVehicleStatuses.includes(query.state.data?.status ?? '') ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
  if (vehicle.isPending) return <StateView loading title="Loading vehicle…" />;
  if (vehicle.isError || !vehicle.data)
    return <StateView title="Vehicle unavailable" message={vehicle.error?.message} />;
  const value = vehicle.data;
  if (managingAvailability)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.page}>
          <BackControl label="Vehicle detail" onPress={() => setManagingAvailability(false)} />
          <AvailabilityStep id={id} vehicle={value} onSaved={() => void vehicle.refetch()} />
        </ScrollView>
      </SafeAreaView>
    );
  const cover = value.photos.find(({ isCover }) => isCover) ?? value.photos[0];
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page}>
        <BackControl label="Fleet" onPress={onClose} />
        <VehicleImage
          contentPath={cover?.fileAsset.contentGrant?.contentPath}
          style={styles.hero}
        />
        <Text style={styles.title}>
          {value.make} {value.model}
        </Text>
        <Text style={styles.body}>
          {value.modelYear ?? '—'} · {value.category?.name ?? 'Vehicle'} ·{' '}
          {domainLabel(value.fuelType)}
        </Text>
        <StatusBadge label={vehicleStatusLabel(value.status)} tone={vehicleTone(value.status)} />
        <View style={styles.wrap}>
          <Choice label="Edit vehicle" selected={false} onPress={onEdit} />
        </View>
        <DetailSection title="Vehicle details">
          <Text style={styles.body}>
            {domainLabel(value.transmission)} · {domainLabel(value.powertrain)} ·{' '}
            {value.color ?? 'Color not set'} · {value.seatCount ?? '—'} seats
          </Text>
        </DetailSection>
        <DetailSection title="Registration / verification">
          <Text style={styles.body}>
            {value.documents.filter(({ replacedAt }) => !replacedAt).length} documents attached ·{' '}
            {value.plateNumber ?? 'Plate not set'}
          </Text>
        </DetailSection>
        <DetailSection title="Pickup location">
          <Text style={styles.body}>
            {value.location
              ? `${value.location.city}, ${value.location.province}`
              : 'Not configured'}
          </Text>
        </DetailSection>
        <DetailSection title="Pricing & usage">
          <Text style={styles.body}>
            {value.policyVersions[0]
              ? `${money(value.policyVersions[0].dailyRateMinor)} / day · ${value.policyVersions[0].turnaroundMinutes / 60}h turnaround`
              : 'Not configured'}
          </Text>
        </DetailSection>
        <DetailSection title="Availability">
          <Text style={styles.body}>
            Available by default except bookings, turnaround, maintenance, and owner blocks.
          </Text>
          <Button
            label="Manage availability"
            onPress={() => setManagingAvailability(true)}
            variant="secondary"
          />
        </DetailSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function VehicleEditor({ id, onClose }: { readonly id: string; readonly onClose: () => void }) {
  const client = useQueryClient();
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(`/owner/vehicles/${id}`),
  });
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [wizardError, setWizardError] = useState('');
  const completedSection = vehicle.data?.lastCompletedSection;
  const completedIndex = steps.findIndex((section) => section.toUpperCase() === completedSection);
  const restoredStep =
    completedSection === 'AVAILABILITY'
      ? steps.length - 1
      : Math.min(completedIndex + 1, steps.length - 1);
  const step = selectedStep ?? Math.max(0, restoredStep);
  const advance = () => {
    setWizardError('');
    setSelectedStep(Math.min(step + 1, steps.length - 1));
  };
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
  const continueDraft = useMutation({
    mutationFn: () => markSectionComplete(id, steps[step] ?? 'Review'),
    onSuccess: advance,
  });
  const continueEditor = () => {
    if (continueDraft.isPending) return;
    if (step === 2 && value.photos.length < 5) {
      setWizardError(
        `Add ${5 - value.photos.length} more required vehicle photo${5 - value.photos.length === 1 ? '' : 's'} before continuing.`,
      );
      return;
    }
    setWizardError('');
    continueDraft.mutate();
  };
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.editorBody}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 && <DetailsStep vehicle={value} onSaved={refresh} onContinue={advance} />}
          {step === 1 && (
            <FeaturesStep
              id={id}
              selectedFeatureIds={value.features.map((item) => item.featureId)}
              onSaved={refresh}
              onContinue={advance}
            />
          )}
          {step === 2 && <PhotosStep id={id} photos={value.photos} onSaved={refresh} />}
          {step === 3 && <DocumentsStep id={id} documents={value.documents} onSaved={refresh} />}
          {step === 4 && (
            <LocationStep id={id} vehicle={value} onSaved={refresh} onContinue={advance} />
          )}
          {step === 5 && (
            <PolicyStep id={id} vehicle={value} onSaved={refresh} onContinue={advance} />
          )}
          {step === 6 && <ReviewStep vehicle={value} action={action.mutate} />}
          {action.error && <Text style={styles.error}>{action.error.message}</Text>}
          {wizardError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {wizardError}
            </Text>
          )}
        </ScrollView>
        <View style={styles.editorActions}>
          {step > 0 && (
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, styles.editorActionButton]}
              onPress={() => {
                setWizardError('');
                setSelectedStep(Math.max(0, step - 1));
              }}
            >
              <Text>Previous</Text>
            </Pressable>
          )}
          {step < steps.length - 1 && ![0, 1, 4, 5].includes(step) && (
            <Pressable
              accessibilityRole="button"
              disabled={continueDraft.isPending}
              style={[styles.primaryButton, styles.editorActionButton]}
              onPress={continueEditor}
            >
              <Text style={styles.primaryText}>
                {continueDraft.isPending ? 'Saving…' : 'Continue'}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailsStep({
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const categories = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/categories'),
  });
  const makes = useQuery({
    queryKey: ['vehicle-makes'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/makes'),
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
  const selectedMake = makes.data?.find(({ name }) => name === vehicle.make || name === form.make);
  const models = useQuery({
    enabled: Boolean(selectedMake),
    queryKey: ['vehicle-models', selectedMake?.id],
    queryFn: () =>
      apiClient.request<Reference[]>(
        `/owner/vehicle-reference-data/models?makeId=${selectedMake?.id ?? ''}`,
      ),
  });
  const listedModel = models.data?.some(({ name }) => name === form.model) ?? false;
  const [customModel, setCustomModel] = useState(Boolean(vehicle.model) && !listedModel);
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${vehicle.id}`, {
        body: JSON.stringify({
          ...form,
          lastCompletedSection: 'DETAILS',
          modelYear: Number(form.modelYear),
          seatCount: Number(form.seatCount),
          doorCount: Number(form.doorCount),
        }),
        method: 'PATCH',
      }),
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Basic details">
      <SearchableReferenceSelector
        label="Make"
        options={(makes.data ?? []).map((item) => ({ ...item, id: item.name }))}
        value={form.make}
        onChange={(make) => {
          setForm({ ...form, make, model: '' });
          setCustomModel(false);
        }}
      />
      <SearchableReferenceSelector
        label="Model"
        options={[
          ...(models.data ?? []).map((item) => ({ ...item, id: item.name })),
          { id: 'OTHER', code: 'OTHER', name: 'Other / Model not listed' },
        ]}
        value={customModel ? 'OTHER' : form.model}
        onChange={(model) => {
          setCustomModel(model === 'OTHER');
          setForm({ ...form, model: model === 'OTHER' ? '' : model });
        }}
      />
      {customModel && (
        <Field
          label="Enter model"
          value={form.model}
          onChange={(model) => setForm({ ...form, model })}
          placeholder="Manufacturer model name"
        />
      )}
      <Field
        label="Model year"
        value={form.modelYear}
        onChange={(modelYear) => setForm({ ...form, modelYear })}
        keyboard="numeric"
      />
      <SearchableReferenceSelector
        label="Vehicle type"
        options={categories.data ?? []}
        value={form.categoryId}
        onChange={(categoryId) => setForm({ ...form, categoryId })}
      />
      <SearchableReferenceSelector
        label="Powertrain"
        options={[
          { id: 'ICE', code: 'ICE', name: 'Combustion engine' },
          { id: 'HYBRID', code: 'HYBRID', name: 'Hybrid' },
          { id: 'PLUG_IN_HYBRID', code: 'PLUG_IN_HYBRID', name: 'Plug-in Hybrid' },
          { id: 'BATTERY_ELECTRIC', code: 'BATTERY_ELECTRIC', name: 'Electric' },
        ]}
        value={form.powertrain}
        onChange={(powertrain) =>
          setForm({
            ...form,
            powertrain,
            fuelType: powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE',
          })
        }
      />
      {form.powertrain !== 'BATTERY_ELECTRIC' && (
        <SearchableReferenceSelector
          label="Fuel"
          options={[
            { id: 'GASOLINE', code: 'GASOLINE', name: 'Gasoline' },
            { id: 'DIESEL', code: 'DIESEL', name: 'Diesel' },
            { id: 'HYBRID', code: 'HYBRID', name: 'Hybrid fuel system' },
            { id: 'OTHER', code: 'OTHER', name: 'Other' },
          ]}
          value={form.fuelType}
          onChange={(fuelType) => setForm({ ...form, fuelType })}
        />
      )}
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
      <Save mutation={save} label="Save and continue" />
    </Section>
  );
}

function FeaturesStep({
  id,
  selectedFeatureIds,
  onSaved,
  onContinue,
}: {
  readonly id: string;
  readonly selectedFeatureIds: string[];
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-features'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/features'),
  });
  const [selected, setSelected] = useState<string[]>(selectedFeatureIds);
  const save = useMutation({
    mutationFn: async () => {
      await apiClient.request(`/owner/vehicles/${id}/features`, {
        body: JSON.stringify({ featureIds: selected }),
        method: 'PUT',
      });
      return markSectionComplete(id, 'Features');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
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
      <Save mutation={save} label="Save and continue" />
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
  const displayedPhotos = [...photos].sort(
    (left, right) =>
      Number(right.isCover) - Number(left.isCover) || left.displayOrder - right.displayOrder,
  );
  const upload = async (perspective: string, camera: boolean) => {
    setError('');
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.back,
          mediaTypes: ['images'],
          quality: 0.85,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          selectionLimit: 1,
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
  const reorder = async (
    next: VehiclePhoto[],
    coverId = next.find(({ isCover }) => isCover)?.id,
  ) => {
    if (!coverId) return;
    try {
      await apiClient.request(`/owner/vehicles/${id}/photos/order`, {
        body: JSON.stringify({
          photos: next.map((photo, displayOrder) => ({
            photoId: photo.id,
            displayOrder,
            isCover: photo.id === coverId,
          })),
        }),
        method: 'PUT',
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reorder photos.');
    }
  };
  const setCover = (photoId: string) => {
    const selected = photos.find(({ id: value }) => value === photoId);
    if (!selected) return;
    void reorder([selected, ...photos.filter(({ id }) => id !== photoId)], photoId);
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
        Add clear photos of the exterior and interior. Your cover photo appears first in search
        results. Photos remain private until the listing is approved.
      </Text>
      {perspectives.map((perspective) => {
        const present = displayedPhotos.filter((photo) => photo.perspective === perspective);
        const multiple = ['INTERIOR', 'DASHBOARD', 'CARGO', 'ADDITIONAL'].includes(perspective);
        return (
          <View key={perspective} style={styles.card}>
            <Text style={styles.cardTitle}>{domainLabel(perspective)}</Text>
            {present.map((photo) => (
              <View key={photo.id} style={styles.photoPreviewRow}>
                <VehicleImage
                  contentPath={photo.fileAsset.contentGrant?.contentPath}
                  style={styles.photoPreview}
                />
                <View style={styles.flex}>
                  <Text style={styles.body}>{photo.isCover ? 'Cover' : 'Vehicle photo'}</Text>
                  <View style={styles.photoActions}>
                    {!photo.isCover && (
                      <Button
                        label="Set cover"
                        onPress={() => setCover(photo.id)}
                        variant="secondary"
                      />
                    )}
                    <Button label="Remove" onPress={() => void remove(photo.id)} variant="danger" />
                  </View>
                </View>
              </View>
            ))}
            {(multiple || present.length === 0) && (
              <View style={styles.wrap}>
                <Choice
                  label="Take photo"
                  selected={false}
                  onPress={() => void upload(perspective, true)}
                />
                <Choice
                  label="Upload photo"
                  selected={false}
                  onPress={() => void upload(perspective, false)}
                />
              </View>
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
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const upload = async (definition: Reference, camera: boolean) => {
    const cameraResult = camera
      ? await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.back,
          mediaTypes: ['images'],
          quality: 0.9,
        })
      : null;
    const pickerResult = camera
      ? null
      : await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          type: ['application/pdf', 'image/*'],
        });
    if (cameraResult?.canceled || pickerResult?.canceled) return;
    const asset = camera ? cameraResult?.assets[0] : pickerResult?.assets[0];
    if (!asset) return;
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'SENSITIVE', {
        uri: asset.uri,
        name: 'name' in asset ? asset.name : (asset.fileName ?? `${definition.code}.jpg`),
        mimeType: asset.mimeType ?? (camera ? 'image/jpeg' : 'application/octet-stream'),
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
      if ((asset.mimeType ?? '').startsWith('image/') || camera) {
        setPreviews((current) => ({ ...current, [definition.id]: asset.uri }));
      }
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
          <View key={definition.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {present ? '✓' : '+'} {definition.name}
            </Text>
            <Text style={styles.body}>
              {definition.required ? 'Required' : 'If applicable'} ·{' '}
              {present
                ? 'Attached · replace or retake before submission'
                : 'Capture or choose a file'}
            </Text>
            {previews[definition.id] && (
              <Image source={{ uri: previews[definition.id] }} style={styles.documentPreview} />
            )}
            <View style={styles.wrap}>
              <Choice
                label={present ? 'Retake' : 'Take photo'}
                selected={false}
                onPress={() => void upload(definition, true)}
              />
              <Choice
                label={present ? 'Replace file' : 'Choose file'}
                selected={false}
                onPress={() => void upload(definition, false)}
              />
            </View>
          </View>
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
  onContinue,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const [form, setForm] = useState({
    latitude: vehicle.location?.latitude ?? '14.5547',
    longitude: vehicle.location?.longitude ?? '121.0244',
    city: vehicle.location?.city ?? '',
    province: vehicle.location?.province ?? 'Metro Manila',
    pickupAreaLabel: vehicle.location?.pickupAreaLabel ?? '',
    regionCode: vehicle.location?.regionCode ?? '',
    addressScopeCode: vehicle.location?.addressScopeCode ?? '',
    provinceCode: vehicle.location?.provinceCode ?? '',
    cityMunicipalityCode: vehicle.location?.cityMunicipalityCode ?? '',
    barangayCode: vehicle.location?.barangayCode ?? '',
    barangay: vehicle.location?.barangay ?? '',
    addressLine1: vehicle.location?.addressLine1 ?? '',
    landmark: vehicle.location?.landmark ?? '',
  });
  const [locationError, setLocationError] = useState('');
  const regions = useQuery({
    queryKey: ['geography', 'regions'],
    queryFn: () => apiClient.request<AreaResponse>('/geography/regions'),
  });
  const scopes = useQuery({
    enabled: Boolean(form.regionCode),
    queryKey: ['geography', 'scopes', form.regionCode],
    queryFn: () => apiClient.request<AreaResponse>(`/geography/regions/${form.regionCode}/scopes`),
  });
  const localities = useQuery({
    enabled: Boolean(form.regionCode && form.addressScopeCode),
    queryKey: ['geography', 'localities', form.regionCode, form.addressScopeCode],
    queryFn: () =>
      apiClient.request<AreaResponse>(
        `/geography/regions/${form.regionCode}/localities?scopeCode=${form.addressScopeCode}`,
      ),
  });
  const barangays = useQuery({
    enabled: Boolean(form.cityMunicipalityCode),
    queryKey: ['geography', 'barangays', form.cityMunicipalityCode],
    queryFn: () =>
      apiClient.request<AreaResponse>(
        `/geography/localities/${form.cityMunicipalityCode}/barangays?limit=100`,
      ),
  });
  const captureDeviceLocation = async () => {
    setLocationError('');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocationError(
        'Location access was not granted. Enable it to save the exact private pickup point.',
      );
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
    mutationFn: async () => {
      await apiClient.request(`/owner/vehicles/${id}/location`, {
        body: JSON.stringify(form),
        method: 'PUT',
      });
      return markSectionComplete(id, 'Location');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Private pickup location">
      <Text style={styles.body}>
        Before booking, renters see only the city/municipality and province. The street, barangay,
        landmark, and exact coordinates remain private until the booking is authorized.
      </Text>
      <SearchableReferenceSelector
        label="Region"
        options={(regions.data?.items ?? []).map((area) => ({
          id: area.code,
          code: area.code,
          name: area.name,
        }))}
        value={form.regionCode}
        onChange={(regionCode) =>
          setForm({
            ...form,
            regionCode,
            addressScopeCode: '',
            provinceCode: '',
            cityMunicipalityCode: '',
            barangayCode: '',
            province: '',
            city: '',
            barangay: '',
          })
        }
      />
      <SearchableReferenceSelector
        label="Province / geographic scope"
        options={(scopes.data?.items ?? []).map((area) => ({
          id: area.code,
          code: area.code,
          name: area.name,
        }))}
        value={form.addressScopeCode}
        onChange={(addressScopeCode) => {
          const area = scopes.data?.items.find(({ code }) => code === addressScopeCode);
          setForm({
            ...form,
            addressScopeCode,
            provinceCode: area?.kind === 'PROVINCE' ? area.code : '',
            province: area?.name ?? '',
            cityMunicipalityCode: '',
            barangayCode: '',
            city: '',
            barangay: '',
          });
        }}
      />
      <SearchableReferenceSelector
        label="City / municipality"
        options={(localities.data?.items ?? []).map((area) => ({
          id: area.code,
          code: area.code,
          name: area.name,
        }))}
        value={form.cityMunicipalityCode}
        onChange={(cityMunicipalityCode) => {
          const area = localities.data?.items.find(({ code }) => code === cityMunicipalityCode);
          setForm({
            ...form,
            cityMunicipalityCode,
            city: area?.name ?? '',
            barangayCode: '',
            barangay: '',
          });
        }}
      />
      <SearchableReferenceSelector
        label="Barangay"
        options={(barangays.data?.items ?? []).map((area) => ({
          id: area.code,
          code: area.code,
          name: area.name,
        }))}
        value={form.barangayCode}
        onChange={(barangayCode) => {
          const area = barangays.data?.items.find(({ code }) => code === barangayCode);
          setForm({ ...form, barangayCode, barangay: area?.name ?? '' });
        }}
      />
      <Field
        label="Street / address line"
        value={form.addressLine1}
        onChange={(addressLine1) => setForm({ ...form, addressLine1 })}
      />
      <Field
        label="Landmark / pickup instructions (optional)"
        value={form.landmark}
        onChange={(landmark) => setForm({ ...form, landmark })}
      />
      <Pressable style={styles.secondaryButton} onPress={() => void captureDeviceLocation()}>
        <Text>Use this device at the pickup point</Text>
      </Pressable>
      {locationError && <Text style={styles.error}>{locationError}</Text>}
      <Save mutation={save} label="Save and continue" />
    </Section>
  );
}

function PolicyStep({
  id,
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
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
    mutationFn: async () => {
      await apiClient.request(`/owner/vehicles/${id}/policy-versions`, {
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
      });
      return markSectionComplete(id, 'Policies');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
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
      <Text style={styles.body}>
        Time reserved after each rental before this vehicle can be booked again.
      </Text>
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
        If you select {turnaround / 60} hours, another renter cannot book the vehicle until that
        time has passed after the previous return. Availability remains server-authoritative.
      </Text>
      <Text style={styles.body}>
        {electric ? 'EV same-to-same, 5% tolerance' : 'Fuel same-to-same, 5% tolerance'} ·
        deficiency charges require platform review. Current rate:{' '}
        {money(Math.round(Number(dailyRate || 0) * 100))} per day.
      </Text>
      <Save mutation={save} label="Save and continue" />
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
  const client = useQueryClient();
  const blocks = useQuery({
    queryKey: ['vehicle-blocks', id],
    queryFn: () => apiClient.request<VehicleBlock[]>(`/owner/vehicles/${id}/blocked-periods`),
  });
  const [reason, setReason] = useState('PERSONAL_USE');
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
          reason,
        }),
        method: 'POST',
      }),
    onSuccess: () => {
      onSaved();
      void client.invalidateQueries({ queryKey: ['vehicle-blocks', id] });
    },
  });
  const remove = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.request(`/owner/vehicles/${id}/blocked-periods/${blockId}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['vehicle-blocks', id] }),
  });
  return (
    <Section title="Availability">
      <Text style={styles.body}>
        Available by default whenever there is no booking, active rental, turnaround, maintenance,
        or owner-created block.
      </Text>
      <Text style={styles.body}>
        Current preparation buffer: {(current?.turnaroundMinutes ?? 120) / 60} hours between
        rentals.
      </Text>
      <Text style={styles.label}>Block a future period</Text>
      <SearchableReferenceSelector
        label="Reason"
        options={[
          { id: 'PERSONAL_USE', code: 'PERSONAL_USE', name: 'Personal use' },
          { id: 'MAINTENANCE', code: 'MAINTENANCE', name: 'Maintenance' },
          { id: 'UNAVAILABLE', code: 'UNAVAILABLE', name: 'Unavailable' },
          { id: 'OTHER', code: 'OTHER', name: 'Other' },
        ]}
        value={reason}
        onChange={setReason}
      />
      <DateTimeField
        label="Starts"
        value={startsAt}
        minimumDate={new Date()}
        onChange={setStartsAt}
      />
      <DateTimeField label="Ends" value={endsAt} minimumDate={startsAt} onChange={setEndsAt} />
      {endsAt <= startsAt && <Text style={styles.error}>End must be after start.</Text>}
      <Save mutation={add} label="Add blocked period" />
      {blocks.data?.map((block) => (
        <View key={block.id} style={styles.card}>
          <Text style={styles.cardTitle}>{domainLabel(block.reason)}</Text>
          <Text style={styles.body}>
            {new Date(block.startsAt).toLocaleString()} → {new Date(block.endsAt).toLocaleString()}
          </Text>
          {new Date(block.startsAt) > new Date() && (
            <Pressable onPress={() => remove.mutate(block.id)}>
              <Text style={styles.error}>Remove future block</Text>
            </Pressable>
          )}
        </View>
      ))}
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

function markSectionComplete(vehicleId: string, section: string) {
  return apiClient.request(`/owner/vehicles/${vehicleId}`, {
    body: JSON.stringify({ lastCompletedSection: section.toUpperCase() }),
    method: 'PATCH',
  });
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
  coverBadge: {
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: 'absolute',
    top: 6,
  },
  coverPreview: { borderRadius: radius.lg, height: 220, marginTop: spacing.sm, width: '100%' },
  documentPreview: { borderRadius: radius.md, height: 180, marginTop: spacing.sm, width: '100%' },
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
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  galleryImage: { height: 104, width: '100%' },
  galleryTile: { borderRadius: radius.md, overflow: 'hidden', position: 'relative', width: '31%' },
  hero: { borderRadius: radius.lg, height: 240, marginTop: spacing.md, width: '100%' },
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
  photoPreview: { borderRadius: radius.sm, height: 82, width: 108 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  photoPreviewRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
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
