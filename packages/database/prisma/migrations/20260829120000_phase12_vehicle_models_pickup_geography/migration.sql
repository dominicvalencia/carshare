CREATE TABLE "vehicle_models" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "make_id" UUID NOT NULL,
  "code" VARCHAR(75) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_models_make_id_fkey" FOREIGN KEY ("make_id") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vehicle_models_make_id_code_key" ON "vehicle_models"("make_id", "code");
CREATE INDEX "vehicle_models_make_id_active_sort_order_idx" ON "vehicle_models"("make_id", "active", "sort_order");

INSERT INTO "vehicle_models" ("make_id", "code", "name", "sort_order")
SELECT m."id", v.code, v.name, v.sort_order
FROM "vehicle_makes" m
JOIN (VALUES
  ('TOYOTA','VIOS','Vios',10), ('TOYOTA','WIGO','Wigo',20), ('TOYOTA','YARIS_CROSS','Yaris Cross',30),
  ('TOYOTA','RAIZE','Raize',40), ('TOYOTA','COROLLA_ALTIS','Corolla Altis',50), ('TOYOTA','CAMRY','Camry',60),
  ('TOYOTA','INNOVA','Innova',70), ('TOYOTA','AVANZA','Avanza',80), ('TOYOTA','VELOZ','Veloz',90),
  ('TOYOTA','FORTUNER','Fortuner',100), ('TOYOTA','HILUX','Hilux',110), ('TOYOTA','HIACE','Hiace',120),
  ('HONDA','CITY','City',10), ('HONDA','BRIO','Brio',20), ('HONDA','CIVIC','Civic',30),
  ('HONDA','HR_V','HR-V',40), ('HONDA','BR_V','BR-V',50), ('HONDA','CR_V','CR-V',60),
  ('MITSUBISHI','MIRAGE','Mirage',10), ('MITSUBISHI','XPANDER','Xpander',20), ('MITSUBISHI','MONTERO_SPORT','Montero Sport',30),
  ('NISSAN','ALMERA','Almera',10), ('NISSAN','KICKS','Kicks e-POWER',20), ('NISSAN','NAVARA','Navara',30),
  ('FORD','TERRITORY','Territory',10), ('FORD','EVEREST','Everest',20), ('FORD','RANGER','Ranger',30),
  ('HYUNDAI','ACCENT','Accent',10), ('HYUNDAI','CRETA','Creta',20), ('HYUNDAI','STARGAZER','Stargazer',30),
  ('KIA','PICANTO','Picanto',10), ('KIA','SONET','Sonet',20), ('KIA','SELTOS','Seltos',30),
  ('SUZUKI','SWIFT','Swift',10), ('SUZUKI','DZIRE','Dzire',20), ('SUZUKI','ERTIGA','Ertiga',30),
  ('ISUZU','MU_X','mu-X',10), ('ISUZU','D_MAX','D-Max',20),
  ('MAZDA','MAZDA2','Mazda2',10), ('MAZDA','MAZDA3','Mazda3',20), ('MAZDA','CX_5','CX-5',30),
  ('BYD','ATTO_3','Atto 3',10), ('BYD','SEALION_6','Sealion 6 DM-i',20), ('BYD','SEAL_5','Seal 5 DM-i',30)
) AS v(make_code, code, name, sort_order) ON v.make_code = m."code";

ALTER TABLE "vehicle_locations"
  ADD COLUMN "region_code" VARCHAR(10),
  ADD COLUMN "address_scope_code" VARCHAR(10),
  ADD COLUMN "province_code" VARCHAR(10),
  ADD COLUMN "city_municipality_code" VARCHAR(10),
  ADD COLUMN "barangay_code" VARCHAR(10),
  ADD COLUMN "barangay" VARCHAR(120),
  ADD COLUMN "address_line1" VARCHAR(255),
  ADD COLUMN "landmark" VARCHAR(255);

CREATE INDEX "vehicle_locations_city_municipality_code_idx" ON "vehicle_locations"("city_municipality_code");
