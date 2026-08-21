# Local infrastructure

Docker Compose provides PostgreSQL and Redis only. Applications run on the host for fast reload.
The local credentials in `.env.example` are intentionally non-production values.

Production deployments must use managed secrets, encrypted transport, backups, and separately
provisioned data services. Do not reuse this Redis configuration without a production review.
