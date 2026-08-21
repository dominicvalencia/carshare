import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import type { OwnerStatus } from '../../auth/auth.types';
import { colors, spacing } from '../../theme/tokens';

interface Session {
  readonly id: string;
  readonly deviceName: string | null;
  readonly platform: string;
  readonly lastUsedAt: string;
  readonly revokedAt: string | null;
}
interface OwnerProfile {
  readonly id: string;
  readonly status: OwnerStatus;
  readonly legalName?: string;
  readonly contactNumber?: string;
  readonly addressLine1?: string;
  readonly city?: string;
  readonly province?: string;
  readonly postalCode?: string;
  readonly rejectionReason?: string;
}
const ownerSchema = z.object({
  legalName: z.string().min(2),
  contactNumber: z.string().min(10),
  addressLine1: z.string().min(4),
  city: z.string().min(2),
  province: z.string().min(2),
  postalCode: z.string().min(4),
  verificationFileId: z.string().optional(),
});
type OwnerForm = z.infer<typeof ownerSchema>;

export function AccountScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiClient.request<Session[]>('/sessions'),
  });
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<OwnerProfile>('/owners/me'),
    enabled: auth.user?.roles.includes('OWNER') ?? false,
    retry: false,
  });
  const startOwner = useMutation({
    mutationFn: () => apiClient.request<OwnerProfile>('/owners/onboarding', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(['owner'], data),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.request(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const form = useForm<OwnerForm>({
    defaultValues: {
      addressLine1: '',
      city: '',
      contactNumber: '',
      legalName: '',
      postalCode: '',
      province: '',
      verificationFileId: '',
    },
    resolver: zodResolver(ownerSchema),
  });
  const saveOwner = useMutation({
    mutationFn: async (data: OwnerForm) => {
      await apiClient.request('/owners/me', { body: JSON.stringify(data), method: 'PATCH' });
      if (data.verificationFileId)
        return apiClient.request('/owners/me/submission', {
          body: JSON.stringify({ verificationFileIds: [data.verificationFileId] }),
          method: 'POST',
        });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owner'] }),
  });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.title}>{auth.user?.email}</Text>
      <Text style={styles.body}>
        Email {auth.user?.emailVerified ? 'verified' : 'verification pending'}
      </Text>
      <Pressable style={styles.button} onPress={() => void auth.logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
      <Text style={styles.heading}>Active devices</Text>
      {sessions.data?.map((session) => (
        <View key={session.id} style={styles.card}>
          <Text style={styles.cardTitle}>{session.deviceName ?? session.platform}</Text>
          <Text style={styles.body}>Last used {new Date(session.lastUsedAt).toLocaleString()}</Text>
          {!session.revokedAt && (
            <Pressable onPress={() => revoke.mutate(session.id)}>
              <Text style={styles.link}>Revoke session</Text>
            </Pressable>
          )}
        </View>
      ))}
      <Text style={styles.heading}>Owner account</Text>
      {!owner.data ? (
        <Pressable style={styles.button} onPress={() => startOwner.mutate()}>
          <Text style={styles.buttonText}>Become an owner</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.status}>Status: {owner.data.status}</Text>
          {owner.data.rejectionReason && (
            <Text style={styles.error}>{owner.data.rejectionReason}</Text>
          )}
          {(owner.data.status === 'DRAFT' || owner.data.status === 'REJECTED') && (
            <View>
              {(
                [
                  'legalName',
                  'contactNumber',
                  'addressLine1',
                  'city',
                  'province',
                  'postalCode',
                  'verificationFileId',
                ] as const
              ).map((name) => (
                <Controller
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field: { onChange, value } }) => (
                    <TextInput
                      onChangeText={onChange}
                      placeholder={
                        name === 'verificationFileId'
                          ? 'Sensitive file ID from secure upload'
                          : name
                      }
                      style={styles.input}
                      value={value}
                    />
                  )}
                />
              ))}
              <Pressable
                style={styles.button}
                onPress={form.handleSubmit((data) => saveOwner.mutate(data))}
              >
                <Text style={styles.buttonText}>Save and submit when document is attached</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: { color: colors.ink, fontWeight: '700' },
  error: { color: '#A12626', marginTop: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  heading: { color: colors.ink, fontSize: 20, fontWeight: '700', marginTop: spacing.xl },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  link: { color: colors.primary, marginTop: spacing.sm },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.md },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: spacing.sm },
});
