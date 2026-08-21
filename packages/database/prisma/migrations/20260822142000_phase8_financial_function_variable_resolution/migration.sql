-- PostgreSQL treats provider_state/external_operation_id/correlation_id as
-- ambiguous inside the financial finalizer because the function parameters
-- intentionally mirror their persisted column names. Prefer function variables
-- for this routine; table identifiers remain explicitly quoted and qualified.
ALTER FUNCTION "finalize_additional_charge_payment"(uuid, uuid, text, text, text)
  SET plpgsql.variable_conflict = 'use_variable';
