# PSGC reference data

`psgc-2q-2026.json` is a normalized, versioned derivative of the Philippine Statistics
Authority's **PSGC 2Q 2026 Publication Datafile**, current as of 30 June 2026. The JSON records
the official source URL and SHA-256 digest of the source workbook.

The normalized artifact contains 18 regions, 82 provinces, 149 cities, 1,493 municipalities, 14
submunicipalities, 42,010 barangays, and two official non-standard grouping rows. `City of Isabela (Not
a Province)` and the BARMM `Special Geographic Area` are represented as special scopes instead of fake
provinces. The source workbook SHA-256 is
`31892bc2bdde3ea0682562d9412b5bab4d45a0be5e5a5b4f6c9d7714b94bca5d`.

Regenerate it only from the official PSA workbook:

```sh
pnpm db:psgc:normalize -- /path/to/PSGC-2Q-2026-Publication-Datafile.xlsx \
  reference/psgc-2q-2026.json
```

Load or refresh PostgreSQL idempotently after migrations:

```sh
pnpm db:psgc:sync
```

The runtime API reads platform-owned PostgreSQL data and never calls PSA from a renter request.
