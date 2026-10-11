import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(resolve(process.cwd(), 'src/navigation/owner-workspace.ts'), 'utf8');
const navigation = readFileSync(resolve(process.cwd(), 'src/navigation/AppNavigation.tsx'), 'utf8');
const messages = readFileSync(
  resolve(process.cwd(), 'src/features/communications/MessagesScreen.tsx'),
  'utf8',
);
const rentals = readFileSync(
  resolve(process.cwd(), 'src/features/rentals/RentalOperationsPanels.tsx'),
  'utf8',
);

describe('Owner delegated operations Phase 5C', () => {
  it('shows Messages only with messages.view and scopes caches to the workspace', () => {
    expect(workspace).toContain("messages: hasOwnerPermission(workspace, 'messages.view')");
    expect(navigation).toContain("['conversations', workspaceKey]");
    expect(messages).toContain("['conversations', queryScope]");
  });

  it('makes delegated messaging read-only without messages.reply', () => {
    expect(messages).toContain("hasOwnerPermission(ownerWorkspace, 'messages.reply')");
    expect(messages).toContain('!canReply');
  });

  it('uses exact incident and claim permissions with workspace routes', () => {
    expect(rentals).toContain("hasOwnerPermission(ownerWorkspace, 'incidents.create')");
    expect(rentals).toContain("hasOwnerPermission(ownerWorkspace, 'claims.view')");
    expect(rentals).toContain("hasOwnerPermission(ownerWorkspace, 'claims.create')");
    expect(rentals).toContain('/owner/workspaces/${ownerWorkspace.ownerProfileId}/bookings/');
  });
});
