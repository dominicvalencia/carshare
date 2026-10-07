import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { retiredVehicleFeatureCodes, vehicleFeatureCatalog } from './vehicle-feature-catalog';

const expansionMigration = readFileSync(
  new URL(
    '../prisma/migrations/20261005170000_expand_vehicle_feature_catalog/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const curationMigration = readFileSync(
  new URL(
    '../prisma/migrations/20261005180000_curate_vehicle_features_and_add_ev_group/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

const originalFeatures = [
  ['AIR_CONDITIONING', 'Air conditioning'],
  ['BLUETOOTH', 'Bluetooth'],
  ['APPLE_CARPLAY', 'Apple CarPlay'],
  ['ANDROID_AUTO', 'Android Auto'],
  ['BACKUP_CAMERA', 'Backup camera'],
  ['PARKING_SENSORS', 'Parking sensors'],
  ['CAMERA_360', '360 camera'],
  ['CRUISE_CONTROL', 'Cruise control'],
  ['ADAPTIVE_CRUISE_CONTROL', 'Adaptive cruise control'],
  ['KEYLESS_ENTRY', 'Keyless entry'],
  ['USB_CHARGING', 'USB charging'],
  ['CHILD_SEAT_COMPATIBLE', 'Child-seat compatibility'],
  ['GPS_NAVIGATION', 'GPS/navigation'],
  ['DASHCAM', 'Dashcam'],
  ['TOLL_RFID', 'Toll/RFID support'],
] as const;

describe('vehicle feature catalog', () => {
  it('keeps the original feature codes and labels intact', () => {
    for (const feature of originalFeatures) expect(vehicleFeatureCatalog).toContainEqual(feature);
  });

  it('has a curated deterministic catalog without duplicate codes or labels', () => {
    expect(vehicleFeatureCatalog).toHaveLength(32);
    expect(new Set(vehicleFeatureCatalog.map(([code]) => code))).toHaveLength(32);
    expect(new Set(vehicleFeatureCatalog.map(([, name]) => name))).toHaveLength(32);
  });

  it('deploys the catalog idempotently without replacing existing UUIDs', () => {
    for (const [code, name] of vehicleFeatureCatalog) {
      expect(`${expansionMigration}\n${curationMigration}`).toContain(
        `'${code}', '${name.replaceAll("'", "''")}'`,
      );
    }
    expect(curationMigration).toContain('ON CONFLICT ("code") DO UPDATE SET');
    expect(curationMigration).not.toMatch(/DO UPDATE SET[\s\S]*"id"\s*=/);
  });

  it('retires accessory and duplicate entries without deleting their stable records', () => {
    for (const code of retiredVehicleFeatureCodes) {
      expect(vehicleFeatureCatalog.some(([activeCode]) => activeCode === code)).toBe(false);
      expect(curationMigration).toContain(`'${code}'`);
    }
    expect(curationMigration).toContain('SET "active" = false');
    expect(curationMigration).not.toContain('DELETE FROM "vehicle_features"');
  });
});
