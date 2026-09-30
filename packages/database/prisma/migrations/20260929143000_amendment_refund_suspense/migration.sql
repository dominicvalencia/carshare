ALTER TYPE "FinancialAccountType" ADD VALUE 'AMENDMENT_REFUND_SUSPENSE';

INSERT INTO "financial_accounts" ("id", "code", "type", "currency", "name")
VALUES (
  gen_random_uuid(),
  'AMENDMENT_REFUND_SUSPENSE',
  'AMENDMENT_REFUND_SUSPENSE',
  'PHP',
  'Accepted amendment refunds awaiting final economic allocation'
)
ON CONFLICT ("code", "currency") DO NOTHING;
