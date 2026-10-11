import type {
  InviteOwnerStaffRequest,
  OwnerStaffDetail,
  OwnerStaffListItem,
  OwnerStaffPreset,
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  OwnerStaffVehicleSummary,
} from '@carrental/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { apiClient, ApiError } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { dateTimeLabel } from '../../ui/format';
import {
  Button,
  BackControl,
  Card,
  Field,
  Icon,
  NestedScreen,
  SegmentedControl,
  SectionHeader,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';

type StaffCapacity = 'OWNER' | 'MANAGER';
type ViewState = { type: 'directory' } | { type: 'invite' } | { type: 'detail'; id: string };

const permissionGroups = [
  {
    title: 'Vehicles',
    items: [
      ['vehicles.view', 'View vehicles'],
      ['vehicles.update_operational_fields', 'Edit operational details'],
      ['availability.view', 'View availability'],
      ['availability.update', 'Manage availability'],
    ],
  },
  {
    title: 'Bookings',
    items: [
      ['bookings.view', 'View booking requests'],
      ['bookings.accept', 'Accept bookings'],
      ['bookings.reject', 'Reject bookings'],
      ['bookings.cancel', 'Cancel eligible bookings'],
    ],
  },
  {
    title: 'Rentals',
    items: [
      ['rentals.view', 'View rentals'],
      ['handover.perform', 'Perform pickup handover'],
      ['return.perform', 'Perform return'],
      ['inspections.create', 'Create inspections'],
      ['inspections.update', 'Update inspections'],
    ],
  },
  {
    title: 'Operations',
    items: [
      ['incidents.create', 'Report incidents'],
      ['incidents.update', 'Update incidents'],
    ],
  },
  {
    title: 'Messages',
    items: [
      ['messages.view', 'View conversations'],
      ['messages.reply', 'Reply to renters'],
    ],
  },
  {
    title: 'Claims',
    items: [
      ['claims.view', 'View claims'],
      ['claims.create', 'Start eligible claims'],
      ['claims.respond', 'Respond to claims'],
    ],
  },
  {
    title: 'Support',
    items: [
      ['users.view_basic_profile', 'View basic renter profiles'],
      ['support_cases.view', 'View support cases'],
      ['support_cases.create', 'Create support cases'],
      ['support_cases.update', 'Update support cases'],
      ['disputes.view', 'View disputes'],
    ],
  },
] as const;

const presetOptions: readonly {
  preset: OwnerStaffPreset;
  role: OwnerStaffRole;
  label: string;
  description: string;
}[] = [
  {
    preset: 'MANAGER',
    role: 'MANAGER',
    label: 'Manager',
    description:
      'Broad operational access and Staff management. Owner-only settings and financial authority remain restricted.',
  },
  {
    preset: 'OPERATIONS_STAFF',
    role: 'STAFF',
    label: 'Operations Staff',
    description: 'Bookings, vehicles, availability, handover, return, and operations.',
  },
  {
    preset: 'SUPPORT_STAFF',
    role: 'STAFF',
    label: 'Support Staff',
    description: 'Bookings, messages, support, claims, and dispute visibility.',
  },
  {
    preset: 'CUSTOM',
    role: 'STAFF',
    label: 'Custom Staff',
    description: 'Choose permissions individually.',
  },
];

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'OWNER_STAFF_MOBILE_INVALID')
    return 'Enter a valid Philippine mobile number.';
  if (error instanceof ApiError && error.code === 'OWNER_STAFF_INVITATION_DELIVERY_FAILED')
    return 'Invitation created, but the SMS could not be sent. You can try sending it again from the Staff member details.';
  if (error instanceof ApiError && error.code === 'RATE_LIMITED')
    return 'Too many invitation attempts. Please wait before sending another invitation to this number.';
  if (error instanceof ApiError && error.status === 403)
    return 'You do not have permission to manage this Staff member.';
  if (error instanceof ApiError && error.status === 404)
    return 'This Staff membership is no longer available.';
  return 'We could not save that change. Check your connection and try again.';
}

export function isPlausiblePhilippineMobile(value: string): boolean {
  const compact = value.replace(/[\s()-]/gu, '');
  return /^(?:\+639|639|09)\d{9}$/u.test(compact);
}

export function friendlyPhilippineMobile(value: string): string {
  const digits = value.replace(/\D/gu, '');
  const local = digits.startsWith('63') ? `0${digits.slice(2)}` : digits;
  return local.length === 11
    ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
    : value.trim();
}

function invitationIdentity(member: OwnerStaffListItem): { label: string; value: string } | null {
  if (member.status === 'INVITED' && member.invitation)
    return {
      label: member.invitation.channel === 'SMS' ? 'Mobile number' : 'Email',
      value: member.invitation.destination,
    };
  return member.email ? { label: 'Email', value: member.email } : null;
}

function statusTone(status: OwnerStaffStatus): 'success' | 'warning' | 'neutral' | 'danger' {
  return { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'neutral', DISABLED: 'danger' }[
    status
  ] as 'success' | 'warning' | 'neutral' | 'danger';
}

function presetLabel(preset: OwnerStaffPreset): string {
  return {
    MANAGER: 'Manager',
    OPERATIONS_STAFF: 'Operations Staff',
    SUPPORT_STAFF: 'Support Staff',
    CUSTOM: 'Custom Staff',
  }[preset];
}

function scopeLabel(member: Pick<OwnerStaffListItem, 'assignedVehicleCount' | 'vehicleScopeMode'>) {
  return member.vehicleScopeMode === 'ALL_VEHICLES'
    ? 'All vehicles'
    : `${member.assignedVehicleCount} selected vehicle${member.assignedVehicleCount === 1 ? '' : 's'}`;
}

export function roleOptionsFor(capacity: StaffCapacity) {
  return presetOptions.filter((option) => capacity === 'OWNER' || option.role !== 'MANAGER');
}

export function canManageMember(
  capacity: StaffCapacity,
  member: Pick<OwnerStaffListItem, 'role'>,
  selfMembershipId?: string,
  memberId?: string,
) {
  return selfMembershipId !== memberId && (capacity === 'OWNER' || member.role === 'STAFF');
}

export function OwnerStaffScreen({
  capacity,
  ownerProfileId,
}: {
  readonly capacity: StaffCapacity;
  readonly ownerProfileId: string;
}) {
  const [view, setView] = useState<ViewState>({ type: 'directory' });
  if (view.type === 'invite')
    return (
      <InviteStaffScreen
        capacity={capacity}
        ownerProfileId={ownerProfileId}
        onBack={() => setView({ type: 'directory' })}
        onCreated={(id) => setView({ type: 'detail', id })}
      />
    );
  if (view.type === 'detail')
    return (
      <StaffDetailScreen
        capacity={capacity}
        membershipId={view.id}
        ownerProfileId={ownerProfileId}
        onBack={() => setView({ type: 'directory' })}
      />
    );
  return (
    <StaffDirectory
      capacity={capacity}
      ownerProfileId={ownerProfileId}
      onAdd={() => setView({ type: 'invite' })}
      onOpen={(id) => setView({ type: 'detail', id })}
    />
  );
}

function StaffDirectory({
  capacity,
  ownerProfileId,
  onAdd,
  onOpen,
}: {
  readonly capacity: StaffCapacity;
  readonly ownerProfileId: string;
  readonly onAdd: () => void;
  readonly onOpen: (id: string) => void;
}) {
  const staff = useQuery({
    queryKey: ['owner-staff', ownerProfileId],
    queryFn: () =>
      apiClient.request<OwnerStaffListItem[]>(`/owner/workspaces/${ownerProfileId}/staff`),
  });
  return (
    <NestedScreen
      eyebrow="Operations"
      title="Staff"
      subtitle="Manage Managers and Staff who help operate your vehicles."
      action={<Button compact icon="person-add-outline" label="Add staff" onPress={onAdd} />}
    >
      {staff.isPending ? (
        <StateView compact loading title="Loading Staff" />
      ) : staff.isError ? (
        <StateView
          compact
          icon="alert-circle-outline"
          title="Staff could not load"
          message={friendlyError(staff.error)}
          actionLabel="Try again"
          onAction={() => void staff.refetch()}
        />
      ) : staff.data.length === 0 ? (
        <Card>
          <StateView
            compact
            icon="people-outline"
            title="No staff yet"
            message="Add a Manager or Staff member to help manage your vehicles and bookings."
            actionLabel="Add staff"
            onAction={onAdd}
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {staff.data.map((member) => (
            <Pressable
              key={member.id}
              accessibilityLabel={`${member.displayName}. ${presetLabel(member.preset)}. ${member.status}. ${scopeLabel(member)}`}
              accessibilityRole="button"
              onPress={() => onOpen(member.id)}
            >
              <Card style={styles.memberRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {member.displayName.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={styles.memberName}>
                    {member.displayName}
                  </Text>
                  {invitationIdentity(member) ? (
                    <Text numberOfLines={1} style={styles.meta}>
                      {invitationIdentity(member)!.value}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {presetLabel(member.preset)} · {scopeLabel(member)}
                  </Text>
                </View>
                <View style={styles.rowEnd}>
                  <StatusBadge
                    label={member.status.charAt(0) + member.status.slice(1).toLowerCase()}
                    tone={statusTone(member.status)}
                  />
                  <Icon color={colors.subtleText} name="chevron-forward" size={18} />
                </View>
              </Card>
            </Pressable>
          ))}
          {capacity === 'MANAGER' ? (
            <Text style={styles.note}>Managers can administer ordinary Staff only.</Text>
          ) : null}
        </View>
      )}
    </NestedScreen>
  );
}

function InviteStaffScreen({
  capacity,
  ownerProfileId,
  onBack,
  onCreated,
}: {
  readonly capacity: StaffCapacity;
  readonly ownerProfileId: string;
  readonly onBack: () => void;
  readonly onCreated: (id: string) => void;
}) {
  const client = useQueryClient();
  const safeArea = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [preset, setPreset] = useState<OwnerStaffPreset>('OPERATIONS_STAFF');
  const [scope, setScope] = useState<OwnerStaffVehicleScopeMode>('ALL_VEHICLES');
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionEditor, setPermissionEditor] = useState(false);
  const [vehiclePicker, setVehiclePicker] = useState(false);
  const [error, setError] = useState('');
  const selectedOption = presetOptions.find((option) => option.preset === preset)!;
  const invite = useMutation({
    mutationFn: () =>
      apiClient.request<OwnerStaffDetail>(`/owner/workspaces/${ownerProfileId}/staff/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: name.trim(),
          mobileNumber: mobileNumber.trim(),
          preset,
          role: selectedOption.role,
          vehicleScopeMode: scope,
          ...(preset === 'CUSTOM' ? { permissions } : {}),
          ...(scope === 'SELECTED_VEHICLES' ? { vehicleIds } : {}),
        } satisfies InviteOwnerStaffRequest),
      }),
    onSuccess: async (member) => {
      await client.invalidateQueries({ queryKey: ['owner-staff', ownerProfileId] });
      Alert.alert(
        'Invitation sent',
        `We sent an invitation to ${friendlyPhilippineMobile(mobileNumber)}.`,
      );
      onCreated(member.id);
    },
    onError: async (value) => {
      if (value instanceof ApiError && value.code === 'OWNER_STAFF_INVITATION_DELIVERY_FAILED') {
        await client.invalidateQueries({ queryKey: ['owner-staff', ownerProfileId] });
        Alert.alert(
          'Invitation created',
          'The SMS could not be sent. You can try sending the invitation again from the Staff member details.',
        );
        onBack();
        return;
      }
      setError(friendlyError(value));
    },
  });
  const valid =
    name.trim().length > 1 &&
    isPlausiblePhilippineMobile(mobileNumber) &&
    (scope === 'ALL_VEHICLES' || vehicleIds.length > 0);
  return (
    <NestedScreen
      backLabel="Staff"
      bottomAccessory={
        <View
          style={[styles.inviteFooter, { paddingBottom: Math.max(safeArea.bottom, spacing.sm) }]}
        >
          <Button
            disabled={!valid || invite.isPending}
            label={invite.isPending ? 'Sending invitation…' : 'Send invitation'}
            onPress={() => {
              setError('');
              invite.mutate();
            }}
          />
        </View>
      }
      contentBottomPadding={spacing.lg}
      onBack={onBack}
      eyebrow="Staff"
      title="Add staff"
      subtitle="Invite someone to help operate this Owner workspace."
    >
      <Card style={styles.formCard}>
        <Field label="Name" placeholder="Enter their name" value={name} onChangeText={setName} />
        <Field
          autoCapitalize="none"
          keyboardType="phone-pad"
          label="Mobile number"
          placeholder="0917 123 4567"
          value={mobileNumber}
          onChangeText={setMobileNumber}
        />
      </Card>
      <SectionHeader title="Access level" />
      <View style={styles.choiceList}>
        {roleOptionsFor(capacity).map((option) => (
          <SelectableOption
            key={option.preset}
            label={option.label}
            description={option.description}
            selected={preset === option.preset}
            onPress={() => {
              setPreset(option.preset);
              setPermissions([]);
            }}
          />
        ))}
      </View>
      {preset === 'CUSTOM' ? (
        <View style={styles.compactSection}>
          <SectionHeader title="Permissions" />
          <Pressable
            accessibilityLabel={`Configure permissions. ${permissions.length} selected`}
            accessibilityRole="button"
            onPress={() => setPermissionEditor(true)}
          >
            <Card style={styles.selectorRow}>
              <View style={styles.flex}>
                <Text style={styles.selectorTitle}>Custom · {permissions.length} selected</Text>
              </View>
              <Text style={styles.selectorAction}>Configure</Text>
              <Icon color={colors.primary} name="chevron-forward" size={19} />
            </Card>
          </Pressable>
        </View>
      ) : null}
      <SectionHeader title="Vehicle access" />
      <Card style={styles.formCard}>
        <SegmentedControl
          accessibilityLabel="Vehicle access"
          options={[
            { label: 'All vehicles', value: 'ALL_VEHICLES' },
            { label: 'Selected vehicles', value: 'SELECTED_VEHICLES' },
          ]}
          value={scope}
          onChange={setScope}
        />
        {scope === 'SELECTED_VEHICLES' ? (
          <View style={styles.compactSelectorSummary}>
            <Text
              accessibilityLabel={`${vehicleIds.length} vehicle${vehicleIds.length === 1 ? '' : 's'} selected`}
              style={styles.selectorTitle}
            >
              {vehicleIds.length} vehicle{vehicleIds.length === 1 ? '' : 's'} selected
            </Text>
            <Button
              compact
              accessibilityLabel="Change selected vehicles"
              label="Change"
              variant="ghost"
              onPress={() => setVehiclePicker(true)}
            />
          </View>
        ) : null}
      </Card>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <VehiclePickerModal
        ownerProfileId={ownerProfileId}
        visible={vehiclePicker}
        selected={vehicleIds}
        onClose={() => setVehiclePicker(false)}
        onChange={setVehicleIds}
      />
      <PermissionEditorModal
        visible={permissionEditor}
        selected={permissions}
        onClose={() => setPermissionEditor(false)}
        onChange={setPermissions}
      />
    </NestedScreen>
  );
}

function PermissionEditor({
  selected,
  onChange,
}: {
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  return (
    <View style={styles.permissionGroups}>
      {permissionGroups.map((group) => (
        <View key={group.title} style={styles.permissionGroup}>
          <PermissionGroupHeader
            title={group.title}
            permissions={group.items.map(([code]) => code)}
            selected={selected}
            onChange={onChange}
          />
          <Card style={styles.permissionCard}>
            {group.items.map(([code, label]) => (
              <Pressable
                key={code}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected.includes(code) }}
                onPress={() =>
                  onChange(
                    selected.includes(code)
                      ? selected.filter((item) => item !== code)
                      : [...selected, code],
                  )
                }
                style={styles.permissionRow}
              >
                <Text style={styles.permissionLabel}>{label}</Text>
                <Icon
                  color={selected.includes(code) ? colors.primary : colors.subtleText}
                  name={selected.includes(code) ? 'checkbox' : 'square-outline'}
                  size={23}
                />
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}

function PermissionGroupHeader({
  title,
  permissions,
  selected,
  onChange,
}: {
  readonly title: string;
  readonly permissions: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  const selectedCount = permissions.filter((permission) => selected.includes(permission)).length;
  const checked: boolean | 'mixed' =
    selectedCount === permissions.length ? true : selectedCount === 0 ? false : 'mixed';
  const toggle = () =>
    onChange(
      checked === true
        ? selected.filter((permission) => !permissions.includes(permission))
        : [...new Set([...selected, ...permissions])],
    );
  return (
    <SectionHeader
      flush
      title={title}
      action={
        <Pressable
          accessibilityLabel={`Select all ${title} permissions`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          onPress={toggle}
          style={styles.selectAllControl}
        >
          <Text style={styles.selectAllText}>Select all</Text>
          <Icon
            color={checked === false ? colors.subtleText : colors.primary}
            name={
              checked === true
                ? 'checkbox'
                : checked === 'mixed'
                  ? 'remove-circle'
                  : 'square-outline'
            }
            size={23}
          />
        </Pressable>
      }
    />
  );
}

function PermissionEditorModal({
  visible,
  selected,
  onClose,
  onChange,
}: {
  readonly visible: boolean;
  readonly selected: readonly string[];
  readonly onClose: () => void;
  readonly onChange: (next: string[]) => void;
}) {
  const [headerHeight, setHeaderHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight,
        headerHeight: headerHeight + footerHeight,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: 0,
      }),
    [contentHeight, footerHeight, headerHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(520, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!visible || headerHeight <= 0 || contentHeight <= 0 || footerHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [
    contentHeight,
    footerHeight,
    headerHeight,
    measuredLayout.height,
    selected.length,
    sheetHeight,
    visible,
  ]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close permission editor"
          onPress={onClose}
          style={styles.backdrop}
        />
        <Reanimated.View
          accessibilityLabel="Configure permissions"
          accessibilityViewIsModal
          style={[styles.sheet, animatedSheetStyle]}
        >
          <View
            onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
            style={styles.sheetHeader}
          >
            <BackControl label="Cancel" onPress={onClose} />
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              Configure permissions
            </Text>
            <Text style={styles.sheetSubtitle}>
              Choose what this Staff member can do in this workspace.
            </Text>
          </View>
          <ScrollView
            contentContainerStyle={styles.permissionSheetContent}
            onContentSizeChange={(_width, height) => setContentHeight(Math.max(height, 120))}
            scrollEnabled={measuredLayout.scrollEnabled}
            showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
          >
            <PermissionEditor selected={selected} onChange={onChange} />
          </ScrollView>
          <View
            onLayout={({ nativeEvent }) => setFooterHeight(nativeEvent.layout.height)}
            style={[styles.sheetFooter, { paddingBottom: Math.max(safeArea.bottom, spacing.lg) }]}
          >
            <Button label="Done" onPress={onClose} />
          </View>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

function SelectableOption({
  label,
  description,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card style={[styles.choice, selected && styles.choiceSelected]}>
        <View style={styles.flex}>
          <Text style={styles.choiceTitle}>{label}</Text>
          <Text style={styles.meta}>{description}</Text>
        </View>
        <Icon
          color={selected ? colors.primary : colors.subtleText}
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
        />
      </Card>
    </Pressable>
  );
}

function VehiclePickerModal({
  ownerProfileId,
  visible,
  selected,
  onChange,
  onClose,
}: {
  readonly ownerProfileId: string;
  readonly visible: boolean;
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const vehicles = useQuery({
    queryKey: ['owner-workspace-vehicles', ownerProfileId],
    queryFn: () =>
      apiClient.request<OwnerStaffVehicleSummary[]>(`/owner/workspaces/${ownerProfileId}/vehicles`),
    enabled: visible,
  });
  const visibleVehicles = (vehicles.data ?? []).filter((vehicle) =>
    [vehicle.modelYear, vehicle.make, vehicle.model]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight,
        headerHeight: headerHeight + footerHeight,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: 0,
      }),
    [contentHeight, footerHeight, headerHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(360, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!visible || headerHeight <= 0 || contentHeight <= 0 || footerHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [
    contentHeight,
    footerHeight,
    headerHeight,
    measuredLayout.height,
    sheetHeight,
    vehicles.dataUpdatedAt,
    vehicles.isError,
    vehicles.isPending,
    visible,
    visibleVehicles.length,
  ]);
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable
          accessibilityLabel="Close vehicle selector"
          onPress={onClose}
          style={styles.backdrop}
        />
        <Reanimated.View
          accessibilityLabel="Select vehicles"
          accessibilityViewIsModal
          style={[styles.sheet, animatedSheetStyle]}
        >
          <View
            onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
            style={styles.sheetHeader}
          >
            <BackControl label="Cancel" onPress={onClose} />
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              Select vehicles
            </Text>
            <Text style={styles.sheetSubtitle}>
              Choose the vehicles this Staff member can access.
            </Text>
            <Field
              autoCapitalize="none"
              label="Search vehicles"
              placeholder="Search by vehicle name"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_width, height) => setContentHeight(Math.max(height, 120))}
            scrollEnabled={measuredLayout.scrollEnabled}
            showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
          >
            {vehicles.isPending ? (
              <StateView compact loading title="Loading vehicles" />
            ) : vehicles.isError ? (
              <StateView
                compact
                icon="alert-circle-outline"
                title="Unable to load vehicles"
                actionLabel="Try again"
                onAction={() => void vehicles.refetch()}
              />
            ) : vehicles.data.length === 0 ? (
              <StateView
                compact
                icon="car-outline"
                title="No vehicles available"
                message="There are no vehicles available to assign in this workspace."
              />
            ) : visibleVehicles.length === 0 ? (
              <StateView
                compact
                icon="search-outline"
                title="No matching vehicles"
                message="Try a different vehicle name."
              />
            ) : (
              <View accessibilityRole="list" style={styles.choiceList}>
                {visibleVehicles.map((vehicle) => {
                  const checked = selected.includes(vehicle.id);
                  const label = [vehicle.modelYear, vehicle.make, vehicle.model]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <Pressable
                      key={vehicle.id}
                      accessibilityLabel={`${label || 'Vehicle'}, ${checked ? 'selected' : 'not selected'}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      onPress={() =>
                        onChange(
                          checked
                            ? selected.filter((id) => id !== vehicle.id)
                            : [...selected, vehicle.id],
                        )
                      }
                    >
                      <Card style={[styles.vehicleRow, checked && styles.choiceSelected]}>
                        <Text style={styles.permissionLabel}>{label || 'Vehicle'}</Text>
                        <Icon
                          color={checked ? colors.primary : colors.subtleText}
                          name={checked ? 'checkbox' : 'square-outline'}
                        />
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
          <View
            onLayout={({ nativeEvent }) => setFooterHeight(nativeEvent.layout.height)}
            style={[styles.sheetFooter, { paddingBottom: Math.max(safeArea.bottom, spacing.lg) }]}
          >
            <Button label="Done" onPress={onClose} />
          </View>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StaffDetailScreen({
  capacity,
  ownerProfileId,
  membershipId,
  onBack,
}: {
  readonly capacity: StaffCapacity;
  readonly ownerProfileId: string;
  readonly membershipId: string;
  readonly onBack: () => void;
}) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState<
    'suspend' | 'reactivate' | 'disable' | 'reissue' | 'revoke' | null
  >(null);
  const [editor, setEditor] = useState<'identity' | 'permissions' | 'vehicles' | null>(null);
  const staffKey = ['owner-staff', ownerProfileId] as const;
  const detailKey = ['owner-staff', ownerProfileId, membershipId] as const;
  const member = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      apiClient.request<OwnerStaffDetail>(
        `/owner/workspaces/${ownerProfileId}/staff/${membershipId}`,
      ),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: staffKey }),
      client.invalidateQueries({ queryKey: detailKey }),
    ]);
  };
  const action = useMutation({
    mutationFn: (kind: NonNullable<typeof confirm>) =>
      apiClient.request<OwnerStaffDetail | { id: string; status: OwnerStaffStatus }>(
        `/owner/workspaces/${ownerProfileId}/staff/${membershipId}/${kind === 'reissue' || kind === 'revoke' ? `invitation/${kind}` : kind}`,
        {
          method: 'POST',
          ...(kind === 'suspend' || kind === 'disable'
            ? {
                body: JSON.stringify({
                  reason:
                    kind === 'suspend'
                      ? 'Access suspended by workspace administrator.'
                      : 'Access permanently disabled by workspace administrator.',
                }),
              }
            : {}),
        },
      ),
    onSuccess: async () => {
      if (confirm === 'reissue') Alert.alert('Invitation sent again');
      setConfirm(null);
      await refresh();
    },
    onError: (error) => Alert.alert('Change not saved', friendlyError(error)),
  });
  if (member.isPending) return <StateView loading title="Loading Staff member" />;
  if (!member.data)
    return (
      <StateView
        icon="alert-circle-outline"
        title="Staff member unavailable"
        message={friendlyError(member.error)}
        actionLabel="Back to Staff"
        onAction={onBack}
      />
    );
  const value = member.data;
  const identity = invitationIdentity(value);
  const manageable = canManageMember(capacity, value);
  return (
    <NestedScreen
      backLabel="Staff"
      onBack={onBack}
      eyebrow="Staff member"
      title={value.displayName}
      subtitle={identity?.value}
    >
      <Card style={styles.detailCard}>
        <View style={styles.headingRow}>
          <Text style={styles.cardTitle}>Identity</Text>
          <StatusBadge
            label={value.status.charAt(0) + value.status.slice(1).toLowerCase()}
            tone={statusTone(value.status)}
          />
        </View>
        <DetailRow label="Role" value={value.role === 'MANAGER' ? 'Manager' : 'Staff'} />
        <DetailRow label="Access level" value={presetLabel(value.preset)} />
        {manageable && value.status !== 'DISABLED' ? (
          <Button
            compact
            label="Edit display name"
            variant="secondary"
            onPress={() => setEditor('identity')}
          />
        ) : null}
      </Card>
      {value.status === 'INVITED' && value.invitation ? (
        <Card style={styles.detailCard}>
          <Text style={styles.cardTitle}>Invitation</Text>
          <DetailRow
            label={identity?.label ?? 'Destination'}
            value={value.invitation.destination}
          />
          <DetailRow label="Expires" value={dateTimeLabel(value.invitation.expiresAt)} />
          {manageable ? (
            <View style={styles.actionRow}>
              <Button
                compact
                label="Reissue invitation"
                variant="secondary"
                onPress={() => setConfirm('reissue')}
              />
              <Button
                compact
                label="Revoke invitation"
                variant="danger"
                onPress={() => setConfirm('revoke')}
              />
            </View>
          ) : null}
        </Card>
      ) : null}
      <Card style={styles.detailCard}>
        <View style={styles.headingRow}>
          <Text style={styles.cardTitle}>Access</Text>
        </View>
        <DetailRow label="Permissions" value={`${value.permissions.length} configured`} />
        {manageable && value.status !== 'DISABLED' ? (
          <Button
            compact
            label="Edit permissions"
            variant="secondary"
            onPress={() => setEditor('permissions')}
          />
        ) : null}
        <DetailRow label="Vehicle access" value={scopeLabel(value)} />
        {manageable && value.status !== 'DISABLED' ? (
          <Button
            compact
            label="Edit vehicle access"
            variant="secondary"
            onPress={() => setEditor('vehicles')}
          />
        ) : null}
      </Card>
      <Card style={styles.detailCard}>
        <Text style={styles.cardTitle}>Activity</Text>
        <DetailRow label="Invited" value={dateTimeLabel(value.invitedAt)} />
        {value.activatedAt ? (
          <DetailRow label="Activated" value={dateTimeLabel(value.activatedAt)} />
        ) : null}
        {value.suspendedAt ? (
          <DetailRow label="Suspended" value={dateTimeLabel(value.suspendedAt)} />
        ) : null}
      </Card>
      {manageable && value.status === 'SUSPENDED' ? (
        <Button
          label="Reactivate access"
          variant="secondary"
          onPress={() => setConfirm('reactivate')}
        />
      ) : null}
      {manageable && value.status === 'ACTIVE' ? (
        <Card style={styles.dangerCard}>
          <Text style={styles.dangerEyebrow}>Danger zone</Text>
          <Text style={styles.cardTitle}>Staff access</Text>
          <Text style={styles.meta}>
            Suspend access temporarily or permanently disable this membership.
          </Text>
          <Button
            label="Suspend access"
            variant="secondary"
            onPress={() => setConfirm('suspend')}
          />
          <Button label="Disable access" variant="danger" onPress={() => setConfirm('disable')} />
        </Card>
      ) : null}
      {value.status === 'DISABLED' ? (
        <Text style={styles.note}>
          This membership is permanently disabled and cannot be reactivated.
        </Text>
      ) : null}
      <ConfirmationModal
        kind={confirm}
        pending={action.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && action.mutate(confirm)}
      />
      <MemberEditorModal
        kind={editor}
        member={value}
        ownerProfileId={ownerProfileId}
        onClose={() => setEditor(null)}
        onSaved={refresh}
      />
    </NestedScreen>
  );
}

function MemberEditorModal({
  kind,
  member,
  ownerProfileId,
  onClose,
  onSaved,
}: {
  readonly kind: 'identity' | 'permissions' | 'vehicles' | null;
  readonly member: OwnerStaffDetail;
  readonly ownerProfileId: string;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(member.displayName);
  const [permissions, setPermissions] = useState<string[]>([...member.permissions]);
  const [scope, setScope] = useState<OwnerStaffVehicleScopeMode>(member.vehicleScopeMode);
  const [vehicleIds, setVehicleIds] = useState<string[]>(
    member.assignedVehicles.map((vehicle) => vehicle.id),
  );
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async () => {
      const base = `/owner/workspaces/${ownerProfileId}/staff/${member.id}`;
      if (kind === 'identity')
        return apiClient.request<OwnerStaffDetail>(base, {
          method: 'PATCH',
          body: JSON.stringify({ displayName: name.trim() }),
        });
      if (kind === 'permissions')
        return apiClient.request<OwnerStaffDetail>(`${base}/permissions`, {
          method: 'PUT',
          body: JSON.stringify({ permissions }),
        });
      return apiClient.request<OwnerStaffDetail>(`${base}/vehicle-scope`, {
        method: 'PUT',
        body: JSON.stringify({
          vehicleScopeMode: scope,
          ...(scope === 'SELECTED_VEHICLES' ? { vehicleIds } : {}),
        }),
      });
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (value) => setError(friendlyError(value)),
  });
  if (!kind) return null;
  const valid =
    kind === 'identity'
      ? name.trim().length > 1
      : kind === 'permissions'
        ? permissions.length > 0
        : scope === 'ALL_VEHICLES' || vehicleIds.length > 0;
  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.sheet}>
          <NestedScreen
            contentGrows={false}
            contentBottomPadding={spacing.lg}
            backLabel="Cancel"
            onBack={onClose}
            title={
              kind === 'identity'
                ? 'Edit display name'
                : kind === 'permissions'
                  ? 'Edit permissions'
                  : 'Vehicle access'
            }
          >
            {kind === 'identity' ? (
              <Card>
                <Field label="Display name" value={name} onChangeText={setName} />
              </Card>
            ) : kind === 'permissions' ? (
              <PermissionEditor selected={permissions} onChange={setPermissions} />
            ) : (
              <Card style={styles.formCard}>
                <SegmentedControl
                  accessibilityLabel="Vehicle access"
                  options={[
                    { label: 'All vehicles', value: 'ALL_VEHICLES' },
                    { label: 'Selected vehicles', value: 'SELECTED_VEHICLES' },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
                {scope === 'SELECTED_VEHICLES' ? (
                  <Button
                    compact
                    label={
                      vehicleIds.length
                        ? `${vehicleIds.length} vehicles selected`
                        : 'Select vehicles'
                    }
                    variant="secondary"
                    onPress={() => setPicker(true)}
                  />
                ) : null}
              </Card>
            )}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Button
              disabled={!valid || mutation.isPending}
              label={mutation.isPending ? 'Saving…' : 'Save changes'}
              onPress={() => mutation.mutate()}
            />
          </NestedScreen>
        </View>
        <VehiclePickerModal
          ownerProfileId={ownerProfileId}
          visible={picker}
          selected={vehicleIds}
          onClose={() => setPicker(false)}
          onChange={setVehicleIds}
        />
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ConfirmationModal({
  kind,
  pending,
  onCancel,
  onConfirm,
}: {
  readonly kind: 'suspend' | 'reactivate' | 'disable' | 'reissue' | 'revoke' | null;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!kind) return null;
  const copies: Record<NonNullable<typeof kind>, readonly [string, string, string]> = {
    suspend: [
      'Suspend access?',
      'This staff member will immediately lose access to this Owner workspace. Their renter account and other workspace access will not be affected.',
      'Suspend access',
    ],
    reactivate: [
      'Reactivate access?',
      "Restore this member's configured permissions and vehicle access.",
      'Reactivate',
    ],
    disable: [
      'Disable staff access?',
      "This permanently disables this Staff membership. It does not delete the user's CarShare account.",
      'Disable access',
    ],
    reissue: [
      'Reissue invitation?',
      'The previous invitation will stop working and a new invitation will be sent.',
      'Reissue invitation',
    ],
    revoke: [
      'Revoke invitation?',
      'This invitation will no longer be available to accept.',
      'Revoke invitation',
    ],
  };
  const copy = copies[kind];
  const destructive = kind === 'suspend' || kind === 'disable' || kind === 'revoke';
  return (
    <Modal animationType="slide" transparent visible onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmSheet}>
          <Text style={styles.confirmTitle}>{copy[0]}</Text>
          <Text style={styles.confirmCopy}>{copy[1]}</Text>
          <Button
            disabled={pending}
            label={pending ? 'Saving…' : copy[2]}
            variant={destructive ? 'danger' : 'primary'}
            onPress={onConfirm}
          />
          <Button disabled={pending} label="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  avatarText: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  choice: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  choiceList: { gap: spacing.sm },
  choiceSelected: { borderColor: colors.primary, borderWidth: 2 },
  choiceTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  compactSection: { gap: spacing.xs },
  confirmCopy: { color: colors.subtleText, fontSize: 15, lineHeight: 22 },
  confirmSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing.lg,
    padding: spacing.xl,
    width: '100%',
  },
  confirmTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  dangerCard: { borderColor: colors.dangerSoft, gap: spacing.md },
  dangerEyebrow: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  detailCard: { gap: spacing.md },
  detailLabel: { color: colors.subtleText, fontSize: 13, fontWeight: '700' },
  detailRow: { gap: spacing.xxs },
  detailValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, lineHeight: 20 },
  flex: { flex: 1 },
  formCard: { gap: spacing.md },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inviteFooter: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  list: { gap: spacing.sm },
  memberName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  memberRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  meta: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  modalBackdrop: { backgroundColor: 'rgba(16, 35, 27, 0.36)', flex: 1, justifyContent: 'flex-end' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16, 35, 27, 0.36)' },
  note: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  permissionCard: { padding: 0 },
  permissionGroup: { gap: spacing.xxs },
  permissionGroups: { gap: spacing.sm },
  permissionSheetContent: { paddingBottom: spacing.md, paddingHorizontal: spacing.xl },
  permissionLabel: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '700' },
  permissionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  rowEnd: { alignItems: 'flex-end', gap: spacing.sm },
  selectAllControl: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
  },
  selectAllText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  selectorAction: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  selectorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  selectorTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  compactSelectorSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    overflow: 'hidden',
    width: '100%',
  },
  sheetContent: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  sheetFooter: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  sheetHeader: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  sheetSubtitle: { color: colors.subtleText, fontSize: 14, lineHeight: 20 },
  sheetTitle: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  vehicleRow: { alignItems: 'center', flexDirection: 'row', minHeight: 54, padding: spacing.md },
});
