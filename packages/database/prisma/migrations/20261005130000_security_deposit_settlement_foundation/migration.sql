CREATE TYPE "SecurityDepositSettlementStatus" AS ENUM (
  'SETTLEMENT_REVIEW',
  'DISPUTED',
  'APPROVED',
  'RELEASE_PENDING',
  'CAPTURE_PENDING',
  'CAPTURED_RELEASE_PENDING',
  'RELEASED',
  'PARTIALLY_USED',
  'USED',
  'SETTLEMENT_UNKNOWN',
  'MANUAL_REVIEW',
  'REVERSED'
);

CREATE TYPE "SecurityDepositSettlementDecisionSource" AS ENUM ('SYSTEM', 'ADMIN');
CREATE TYPE "SecurityDepositSettlementLegRole" AS ENUM ('CAPTURE', 'RELEASE', 'REFUND', 'REVERSAL');

CREATE TABLE "security_deposit_settlements" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "security_deposit_authorization_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "SecurityDepositSettlementStatus" NOT NULL DEFAULT 'SETTLEMENT_REVIEW',
  "decision_source" "SecurityDepositSettlementDecisionSource" NOT NULL DEFAULT 'SYSTEM',
  "decision_reason" VARCHAR(3000),
  "authorized_amount_minor_snapshot" BIGINT NOT NULL,
  "approved_deduction_minor" BIGINT NOT NULL DEFAULT 0,
  "release_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "approved_by_user_id" UUID,
  "approved_at" TIMESTAMPTZ(3),
  "execution_authority_entered_at" TIMESTAMPTZ(3),
  "execution_started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "reconciliation_required_at" TIMESTAMPTZ(3),
  "manual_review_reason" VARCHAR(3000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "security_deposit_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_deposit_settlement_amounts_nonnegative" CHECK (
    "authorized_amount_minor_snapshot" >= 0 AND
    "approved_deduction_minor" >= 0 AND
    "release_amount_minor" >= 0
  ),
  CONSTRAINT "security_deposit_settlement_amounts_bounded" CHECK (
    "approved_deduction_minor" + "release_amount_minor" <= "authorized_amount_minor_snapshot"
  ),
  CONSTRAINT "security_deposit_settlement_approval_consistent" CHECK (
    ("status" = 'APPROVED' AND "approved_at" IS NOT NULL AND "approved_by_user_id" IS NOT NULL) OR
    ("status" <> 'APPROVED')
  ),
  CONSTRAINT "security_deposit_settlement_manual_review_reason" CHECK (
    "status" <> 'MANUAL_REVIEW' OR ("manual_review_reason" IS NOT NULL AND length(trim("manual_review_reason")) >= 10)
  )
);

CREATE TABLE "security_deposit_settlement_items" (
  "id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "claim_adjudication_id" UUID NOT NULL,
  "additional_charge_id" UUID NOT NULL,
  "claim_calculation_id" UUID,
  "category" "AdditionalChargeLineCategory" NOT NULL,
  "approved_amount_minor" BIGINT NOT NULL,
  "deposit_applied_minor" BIGINT NOT NULL,
  "excess_amount_minor" BIGINT NOT NULL,
  "owner_compensation_minor" BIGINT NOT NULL,
  "platform_share_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "calculation_version" INTEGER,
  "policy_version" INTEGER,
  "adjudication_version" INTEGER NOT NULL,
  "description_snapshot" VARCHAR(3000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_deposit_settlement_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_deposit_settlement_item_amounts_nonnegative" CHECK (
    "approved_amount_minor" >= 0 AND
    "deposit_applied_minor" >= 0 AND
    "excess_amount_minor" >= 0 AND
    "owner_compensation_minor" >= 0 AND
    "platform_share_minor" >= 0
  ),
  CONSTRAINT "security_deposit_settlement_item_allocation" CHECK (
    "deposit_applied_minor" + "excess_amount_minor" = "approved_amount_minor"
  ),
  CONSTRAINT "security_deposit_settlement_item_shares" CHECK (
    "owner_compensation_minor" + "platform_share_minor" = "approved_amount_minor"
  )
);

CREATE TABLE "security_deposit_settlement_legs" (
  "id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "payment_operation_id" UUID NOT NULL,
  "role" "SecurityDepositSettlementLegRole" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "expected_amount_minor" BIGINT NOT NULL,
  "expected_aggregate_state" VARCHAR(50),
  "reverses_leg_id" UUID,
  "supersedes_leg_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_deposit_settlement_legs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_deposit_settlement_leg_amount_nonnegative" CHECK ("expected_amount_minor" >= 0),
  CONSTRAINT "security_deposit_settlement_leg_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "security_deposit_settlement_leg_distinct_references" CHECK (
    "id" IS DISTINCT FROM "reverses_leg_id" AND "id" IS DISTINCT FROM "supersedes_leg_id"
  )
);

CREATE UNIQUE INDEX "security_deposit_settlements_authorization_version_key"
  ON "security_deposit_settlements"("security_deposit_authorization_id", "version");
CREATE UNIQUE INDEX "security_deposit_settlement_single_execution_authority"
  ON "security_deposit_settlements"("security_deposit_authorization_id")
  WHERE "execution_authority_entered_at" IS NOT NULL;
CREATE INDEX "security_deposit_settlements_booking_status_created_idx"
  ON "security_deposit_settlements"("booking_id", "status", "created_at");
CREATE INDEX "security_deposit_settlements_status_reconciliation_idx"
  ON "security_deposit_settlements"("status", "reconciliation_required_at");
CREATE UNIQUE INDEX "security_deposit_settlement_items_settlement_charge_key"
  ON "security_deposit_settlement_items"("settlement_id", "additional_charge_id");
CREATE INDEX "security_deposit_settlement_items_claim_idx"
  ON "security_deposit_settlement_items"("claim_id");
CREATE INDEX "security_deposit_settlement_items_adjudication_idx"
  ON "security_deposit_settlement_items"("claim_adjudication_id");
CREATE UNIQUE INDEX "security_deposit_settlement_legs_payment_operation_key"
  ON "security_deposit_settlement_legs"("payment_operation_id");
CREATE UNIQUE INDEX "security_deposit_settlement_legs_role_sequence_key"
  ON "security_deposit_settlement_legs"("settlement_id", "role", "sequence");
CREATE INDEX "security_deposit_settlement_legs_settlement_created_idx"
  ON "security_deposit_settlement_legs"("settlement_id", "created_at");

ALTER TABLE "security_deposit_settlements"
  ADD CONSTRAINT "security_deposit_settlements_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlements_authorization_id_fkey"
  FOREIGN KEY ("security_deposit_authorization_id") REFERENCES "security_deposit_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlements_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "security_deposit_settlement_items"
  ADD CONSTRAINT "security_deposit_settlement_items_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "security_deposit_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_items_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_items_adjudication_id_fkey"
  FOREIGN KEY ("claim_adjudication_id") REFERENCES "claim_adjudications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_items_charge_id_fkey"
  FOREIGN KEY ("additional_charge_id") REFERENCES "additional_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_items_calculation_id_fkey"
  FOREIGN KEY ("claim_calculation_id") REFERENCES "claim_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "security_deposit_settlement_legs"
  ADD CONSTRAINT "security_deposit_settlement_legs_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "security_deposit_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_legs_operation_id_fkey"
  FOREIGN KEY ("payment_operation_id") REFERENCES "payment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_legs_reverses_leg_id_fkey"
  FOREIGN KEY ("reverses_leg_id") REFERENCES "security_deposit_settlement_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "security_deposit_settlement_legs_supersedes_leg_id_fkey"
  FOREIGN KEY ("supersedes_leg_id") REFERENCES "security_deposit_settlement_legs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
