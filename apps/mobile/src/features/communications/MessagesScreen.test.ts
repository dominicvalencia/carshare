import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { conversationHeading } from './conversation-heading';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'MessagesScreen.tsx'),
  'utf8',
);

describe('conversationHeading', () => {
  it('uses authoritative vehicle context when it is present', () => {
    expect(
      conversationHeading({
        vehicle: { make: 'Toyota', model: 'Vios' },
      }),
    ).toBe('Toyota Vios');
  });

  it('uses a legitimate fallback while context is loading or absent', () => {
    expect(conversationHeading()).toBe('Booking conversation');
    expect(conversationHeading({ vehicle: undefined })).toBe('Booking conversation');
  });
});

describe('messages and notifications entry separation', () => {
  it('puts the notification bell and its own unread summary in Messages', () => {
    expect(source).toContain('Open notifications');
    expect(source).toContain("['notification-summary', queryScope]");
    expect(source).toContain('audience=${mode.toUpperCase()}');
    expect(source).toContain("navigation.navigate('Notifications')");
  });

  it('scopes conversation data and unread activity to the active role', () => {
    expect(source).toContain("['conversations', queryScope]");
    expect(source).toContain("['conversation', selected, queryScope]");
    expect(source).toContain("['messages', selected, queryScope]");
    expect(source.match(/audience=\$\{mode\.toUpperCase\(\)\}/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('uses workspace-scoped routes and hides the composer without messages.reply', () => {
    expect(source).toContain('/owner/workspaces/${ownerWorkspace!.ownerProfileId}/conversations');
    expect(source).toContain("hasOwnerPermission(ownerWorkspace, 'messages.reply')");
    expect(source).toContain('You have read-only access to this conversation.');
  });
});
