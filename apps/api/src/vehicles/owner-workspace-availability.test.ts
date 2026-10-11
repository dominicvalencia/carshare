import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const controller = readFileSync(
  resolve(process.cwd(), 'src/vehicles/owner-workspace-vehicles.controller.ts'),
  'utf8',
);
const service = readFileSync(resolve(process.cwd(), 'src/vehicles/vehicles.service.ts'), 'utf8');

describe('Owner workspace availability delegation', () => {
  it('requires exact view and update permissions on workspace routes', () => {
    expect(controller).toContain("@RequireOwnerPermission('availability.view')");
    expect(controller).toContain("@RequireOwnerPermission('availability.update')");
    expect(controller).toContain('blockedPeriodsForOwnerAccess(principal.ownerAccess!, id)');
  });

  it('checks assigned-vehicle access before availability reads and writes', () => {
    expect(service).toContain("assertVehicleAccess(context, id, 'availability.view')");
    expect(service).toContain("assertVehicleAccess(context, id, 'availability.update')");
  });

  it('keeps the existing transactional occupancy authority and records the acting user', () => {
    expect(service).toContain('this.occupancy.createOwnerBlock(transaction');
    expect(service).toContain('createdByUserId: actorUserId');
    expect(service).toContain('this.occupancy.release(transaction, block.occupancyId');
  });
});
