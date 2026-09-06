ALTER TABLE "device_push_tokens"
  ADD COLUMN "environment" VARCHAR(20) NOT NULL DEFAULT 'local',
  ADD COLUMN "app_identifier" VARCHAR(160) NOT NULL DEFAULT 'ph.carshare.mobile';

DROP INDEX "device_push_tokens_token_key";

CREATE UNIQUE INDEX "device_push_tokens_environment_app_identifier_token_key"
  ON "device_push_tokens"("environment", "app_identifier", "token");
