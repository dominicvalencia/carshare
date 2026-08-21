-- CreateTable
CREATE TABLE "user_favorites" (
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("user_id","vehicle_id")
);

-- CreateTable
CREATE TABLE "pricing_quotes" (
    "id" UUID NOT NULL,
    "renter_user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "rental_start" TIMESTAMPTZ(3) NOT NULL,
    "rental_end" TIMESTAMPTZ(3) NOT NULL,
    "vehicle_timezone" VARCHAR(64) NOT NULL,
    "chargeable_days" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "unlimited_mileage" BOOLEAN NOT NULL,
    "included_mileage_km" INTEGER,
    "excess_kilometer_rate_minor" INTEGER,
    "fuel_return_policy" VARCHAR(50),
    "ev_return_policy" VARCHAR(50),
    "turnaround_minutes" INTEGER NOT NULL,
    "pricing_engine_version" VARCHAR(100) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_quote_lines" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_amount_minor" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(75) NOT NULL,
    "user_id" UUID,
    "vehicle_id" UUID,
    "quote_id" UUID,
    "correlation_id" VARCHAR(100),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_favorites_user_id_created_at_idx" ON "user_favorites"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_favorites_vehicle_id_idx" ON "user_favorites"("vehicle_id");

-- CreateIndex
CREATE INDEX "pricing_quotes_renter_user_id_created_at_idx" ON "pricing_quotes"("renter_user_id", "created_at");

-- CreateIndex
CREATE INDEX "pricing_quotes_vehicle_id_created_at_idx" ON "pricing_quotes"("vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "pricing_quotes_expires_at_idx" ON "pricing_quotes"("expires_at");

-- CreateIndex
CREATE INDEX "pricing_quote_lines_quote_id_display_order_idx" ON "pricing_quote_lines"("quote_id", "display_order");

-- CreateIndex
CREATE INDEX "analytics_events_event_type_occurred_at_idx" ON "analytics_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_user_id_occurred_at_idx" ON "analytics_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_vehicle_id_occurred_at_idx" ON "analytics_events"("vehicle_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_quotes" ADD CONSTRAINT "pricing_quotes_renter_user_id_fkey" FOREIGN KEY ("renter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_quotes" ADD CONSTRAINT "pricing_quotes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_quotes" ADD CONSTRAINT "pricing_quotes_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_quote_lines" ADD CONSTRAINT "pricing_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quotes are immutable, reproducible pricing artifacts. Keep arithmetic and
-- lifecycle invariants at the database boundary as a second line of defense.
ALTER TABLE "pricing_quotes"
  ADD CONSTRAINT "pricing_quotes_period_check" CHECK ("rental_start" < "rental_end"),
  ADD CONSTRAINT "pricing_quotes_duration_check" CHECK ("chargeable_days" > 0),
  ADD CONSTRAINT "pricing_quotes_currency_check" CHECK ("currency" = 'PHP'),
  ADD CONSTRAINT "pricing_quotes_amounts_check" CHECK (
    "subtotal_minor" >= 0 AND "total_minor" >= 0 AND "total_minor" = "subtotal_minor"
  ),
  ADD CONSTRAINT "pricing_quotes_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "pricing_quotes_mileage_check" CHECK (
    ("unlimited_mileage" AND "included_mileage_km" IS NULL AND "excess_kilometer_rate_minor" IS NULL)
    OR
    (NOT "unlimited_mileage" AND "included_mileage_km" IS NOT NULL AND "included_mileage_km" >= 0
      AND "excess_kilometer_rate_minor" IS NOT NULL AND "excess_kilometer_rate_minor" >= 0)
  );

ALTER TABLE "pricing_quote_lines"
  ADD CONSTRAINT "pricing_quote_lines_values_check" CHECK (
    "quantity" > 0 AND "unit_amount_minor" >= 0 AND "amount_minor" >= 0
    AND "amount_minor" = "quantity" * "unit_amount_minor"
  );

CREATE INDEX "vehicles_public_discovery_idx"
  ON "vehicles"("status", "operational_status", "approved_at" DESC, "id");
CREATE INDEX "vehicle_policy_versions_latest_idx"
  ON "vehicle_policy_versions"("vehicle_id", "version" DESC);

CREATE TRIGGER "pricing_quotes_append_only"
  BEFORE UPDATE OR DELETE ON "pricing_quotes"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "pricing_quote_lines_append_only"
  BEFORE UPDATE OR DELETE ON "pricing_quote_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "analytics_events_append_only"
  BEFORE UPDATE OR DELETE ON "analytics_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
