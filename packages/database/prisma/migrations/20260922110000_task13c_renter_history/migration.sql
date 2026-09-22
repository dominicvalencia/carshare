CREATE TABLE "renter_recent_searches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "place_label" VARCHAR(120) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "province" VARCHAR(100) NOT NULL,
    "center_latitude" DECIMAL(4,1) NOT NULL,
    "center_longitude" DECIMAL(4,1) NOT NULL,
    "radius_km" INTEGER NOT NULL,
    "rental_start" TIMESTAMPTZ(3),
    "rental_end" TIMESTAMPTZ(3),
    "criteria" JSONB NOT NULL,
    "searched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "renter_recent_searches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "renter_recent_searches_radius_check" CHECK ("radius_km" BETWEEN 1 AND 1000),
    CONSTRAINT "renter_recent_searches_dates_check" CHECK (
      ("rental_start" IS NULL AND "rental_end" IS NULL) OR
      ("rental_start" IS NOT NULL AND "rental_end" IS NOT NULL AND "rental_end" > "rental_start")
    )
);

CREATE TABLE "renter_recent_vehicle_views" (
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "renter_recent_vehicle_views_pkey" PRIMARY KEY ("user_id","vehicle_id")
);

CREATE INDEX "renter_recent_searches_user_id_searched_at_id_idx"
  ON "renter_recent_searches"("user_id", "searched_at" DESC, "id" DESC);
CREATE INDEX "renter_recent_vehicle_views_user_id_viewed_at_vehicle_id_idx"
  ON "renter_recent_vehicle_views"("user_id", "viewed_at" DESC, "vehicle_id" DESC);

ALTER TABLE "renter_recent_searches" ADD CONSTRAINT "renter_recent_searches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "renter_recent_vehicle_views" ADD CONSTRAINT "renter_recent_vehicle_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "renter_recent_vehicle_views" ADD CONSTRAINT "renter_recent_vehicle_views_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
