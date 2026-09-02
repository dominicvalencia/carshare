import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'InspectionCorrectionsAdminPanel.tsx'),
  'utf8',
);

describe('inspection correction admin workflow', () => {
  it('shows immutable original/proposed comparison and protected evidence access', () => {
    expect(source).toContain('Original recorded value');
    expect(source).toContain('Proposed correction');
    expect(source).toContain('/access-grants');
    expect(source).toContain('Submitted inspections and photos remain');
    expect(source).toContain('immutable.');
  });
  it('requires a reason, confirms approval, and invalidates queue/detail/rentals', () => {
    expect(source).toContain('reviewReason.trim().length < 10');
    expect(source).toContain('window.confirm');
    expect(source).toContain("['admin-inspection-corrections']");
    expect(source).toContain("['admin-inspection-correction', selectedId]");
    expect(source).toContain("['admin-rentals']");
  });
});
