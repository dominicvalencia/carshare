ALTER TABLE "vehicle_policy_versions"
  ADD COLUMN "security_deposit_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "security_deposit_amount_minor" INTEGER,
  ADD COLUMN "security_deposit_currency" CHAR(3);

ALTER TABLE "vehicle_policy_versions"
  ADD CONSTRAINT "vehicle_policy_versions_security_deposit_check" CHECK (
    (
      "security_deposit_required" = false AND
      "security_deposit_amount_minor" IS NULL AND
      "security_deposit_currency" IS NULL
    ) OR (
      "security_deposit_required" = true AND
      "security_deposit_amount_minor" > 0 AND
      "security_deposit_currency" IS NOT NULL
    )
  );

ALTER TABLE "booking_policy_snapshots"
  ADD COLUMN "security_deposit_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "security_deposit_amount_minor" INTEGER,
  ADD COLUMN "security_deposit_currency" CHAR(3);

ALTER TABLE "booking_policy_snapshots"
  ADD CONSTRAINT "booking_policy_snapshots_security_deposit_check" CHECK (
    (
      "security_deposit_required" = false AND
      "security_deposit_amount_minor" IS NULL AND
      "security_deposit_currency" IS NULL
    ) OR (
      "security_deposit_required" = true AND
      "security_deposit_amount_minor" > 0 AND
      "security_deposit_currency" IS NOT NULL
    )
  );
