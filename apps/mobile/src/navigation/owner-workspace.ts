import type { OwnerWorkspace } from '../auth/auth.types';

export function activeOwnerWorkspaces(workspaces: readonly OwnerWorkspace[]) {
  return workspaces.filter(
    (workspace) => workspace.capacity === 'OWNER' || workspace.membershipStatus === 'ACTIVE',
  );
}

export function resolveOwnerWorkspace(
  workspaces: readonly OwnerWorkspace[],
  savedOwnerProfileId: string | null,
) {
  const active = activeOwnerWorkspaces(workspaces);
  return (
    active.find(({ ownerProfileId }) => ownerProfileId === savedOwnerProfileId) ?? active[0] ?? null
  );
}

export function hasOwnerPermission(workspace: OwnerWorkspace, permission: string) {
  return workspace.capacity === 'OWNER' || workspace.permissions.includes(permission);
}

export function delegatedOwnerTabs(workspace: OwnerWorkspace) {
  if (workspace.capacity === 'OWNER')
    return { today: true, vehicles: true, messages: true, more: true } as const;
  return {
    // Today is composed only from migrated, workspace-scoped read domains.
    today: ['bookings.view', 'rentals.view', 'vehicles.view', 'messages.view'].some((permission) =>
      hasOwnerPermission(workspace, permission),
    ),
    vehicles: hasOwnerPermission(workspace, 'vehicles.view'),
    messages: hasOwnerPermission(workspace, 'messages.view'),
    more: true,
  } as const;
}

export function ownerWorkspaceLabel(workspace: OwnerWorkspace) {
  return (
    workspace.workspaceLabel?.trim() ||
    (workspace.capacity === 'OWNER' ? 'Your Owner workspace' : 'Owner workspace')
  );
}
