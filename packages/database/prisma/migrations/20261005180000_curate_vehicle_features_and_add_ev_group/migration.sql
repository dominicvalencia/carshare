INSERT INTO "vehicle_features" (
  "id",
  "code",
  "name",
  "active",
  "sort_order",
  "created_at",
  "updated_at"
)
VALUES
  (gen_random_uuid(), 'AIR_CONDITIONING', 'Air conditioning', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REAR_AIR_CONDITIONING', 'Rear air-conditioning', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEATHER_SEATS', 'Leather seats', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PUSH_BUTTON_START', 'Push-button start', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'KEYLESS_ENTRY', 'Keyless entry', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CRUISE_CONTROL', 'Cruise control', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ADAPTIVE_CRUISE_CONTROL', 'Adaptive cruise control', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUNROOF_MOONROOF', 'Sunroof / moonroof', true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BLUETOOTH', 'Bluetooth', true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'APPLE_CARPLAY', 'Apple CarPlay', true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ANDROID_AUTO', 'Android Auto', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WIRELESS_PHONE_CHARGING', 'Wireless phone charging', true, 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'USB_CHARGING', 'USB charging', true, 12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GPS_NAVIGATION', 'GPS/navigation', true, 13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BACKUP_CAMERA', 'Backup camera', true, 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CAMERA_360', '360 camera', true, 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PARKING_SENSORS', 'Parking sensors', true, 16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BLIND_SPOT_MONITORING', 'Blind-spot monitoring', true, 17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LANE_KEEPING_ASSIST', 'Lane-keeping assist', true, 18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AUTOMATIC_EMERGENCY_BRAKING', 'Automatic emergency braking', true, 19, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DASHCAM', 'Dashcam', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHILD_SEAT_COMPATIBLE', 'Child-seat compatibility', true, 21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FAST_CHARGING_SUPPORT', 'Fast-charging support', true, 22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PORTABLE_CHARGING_CABLE', 'Portable charging cable included', true, 23, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHARGING_ADAPTER', 'Charging adapter included', true, 24, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REGENERATIVE_BRAKING', 'Regenerative braking', true, 25, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'V2L_SUPPORT', 'V2L support', true, 26, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ONE_PEDAL_DRIVING', 'One-pedal driving', true, 27, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BATTERY_PRECONDITIONING', 'Battery preconditioning', true, 28, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TOLL_RFID', 'Toll/RFID support', true, 29, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AUTOSWEEP_RFID', 'Autosweep RFID', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EASYTRIP_RFID', 'Easytrip RFID', true, 31, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "active" = EXCLUDED."active",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "vehicle_features"
SET "active" = false, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'AUTOMATIC_CLIMATE_CONTROL',
  'REMOTE_START',
  'POWER_TAILGATE',
  'USB_C_CHARGING',
  'WIFI_HOTSPOT',
  'LANE_DEPARTURE_WARNING',
  'FORWARD_COLLISION_WARNING',
  'TIRE_PRESSURE_MONITORING',
  'PHONE_HOLDER'
);
