# Secret inventory template

Record metadata only. Never paste a secret value or recovery code here.

| Secret name | Service | Environment | Purpose   | Owner         | Source/provider | Storage              | Created    | Next rotation | Rotation mechanism | Emergency revocation |
| ----------- | ------- | ----------- | --------- | ------------- | --------------- | -------------------- | ---------- | ------------- | ------------------ | -------------------- |
| _example_   | API     | staging     | _purpose_ | Primary owner | _provider_      | Managed secret store | YYYY-MM-DD | YYYY-MM-DD    | _runbook_          | _procedure_          |

Rotation: create a least-privilege replacement; deploy to one environment; verify health and a safe
operation; revoke the old credential; confirm denial; update inventory/audit records. Rotate after
suspected disclosure or access removal, and at least every 90 days for high-impact secrets.

The inventory covers JWT and token-hash keys, encryption keys, DB/Redis credentials, provider API
keys, webhook secrets, APNs/FCM credentials, object-storage credentials, and deployment credentials.
