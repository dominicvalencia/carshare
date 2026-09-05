CREATE TYPE "NotificationAudience" AS ENUM ('ACCOUNT', 'RENTER', 'OWNER');

ALTER TABLE "notifications"
ADD COLUMN "audience" "NotificationAudience" NOT NULL DEFAULT 'ACCOUNT';

DROP INDEX "notifications_user_id_read_at_created_at_idx";
CREATE INDEX "notifications_user_id_audience_read_at_created_at_idx"
ON "notifications"("user_id", "audience", "read_at", "created_at");
