-- Historical payout items continue to sum to the immutable payout amount after an
-- active allocation is released by cancellation, failure, or reversal.
CREATE OR REPLACE FUNCTION "assert_payout_total"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; expected bigint; actual bigint;
BEGIN
  target_id := COALESCE(NEW."payout_id", OLD."payout_id");
  SELECT "amount_minor" INTO expected FROM "payouts" WHERE "id" = target_id;
  SELECT COALESCE(sum("amount_minor"), 0) INTO actual FROM "payout_items"
    WHERE "payout_id" = target_id;
  IF expected <> actual AND EXISTS (SELECT 1 FROM "payouts" WHERE "id" = target_id AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'payout amount must equal payout items';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "enforce_payout_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('PENDING_APPROVAL', 'CANCELLED'))
    OR (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('APPROVED', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('SUBMITTING', 'CANCELLED'))
    OR (OLD."status" = 'SUBMITTING' AND NEW."status" IN ('PROCESSING', 'FAILED'))
    OR (OLD."status" = 'PROCESSING' AND NEW."status" IN ('PAID', 'FAILED', 'REVERSED'))
    OR (OLD."status" = 'PAID' AND NEW."status" = 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'invalid payout state transition % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."status" = 'PAID' AND (NEW."paid_at" IS NULL OR NEW."provider_payout_id" IS NULL) THEN
    RAISE EXCEPTION 'PAID payout requires provider identity and authoritative paid timestamp';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_state_machine" BEFORE UPDATE OF "status" ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_payout_transition"();
