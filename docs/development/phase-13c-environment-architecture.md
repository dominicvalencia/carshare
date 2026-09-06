# Phase 13C-1 environment architecture

Phase 13C-1 establishes configuration and operating contracts only. It does not provision cloud
resources, domains, DNS, EAS projects, production providers, monitoring, or deployments.

| Environment | Purpose                      | Mobile identity                                  | URL policy            | Data boundary            |
| ----------- | ---------------------------- | ------------------------------------------------ | --------------------- | ------------------------ |
| local       | Developer/native-client work | `ph.carshare.mobile`, `carrental`                | localhost/LAN allowed | local DB, Redis, files   |
| test        | Automated tests              | `ph.carshare.mobile.test`, `carshare-test`       | test harness          | disposable test data     |
| staging     | Pilot rehearsal              | `ph.carshare.mobile.staging`, `carshare-staging` | public HTTPS required | staging-only services    |
| production  | Live marketplace             | `ph.carshare.mobile`, `carshare`                 | public HTTPS required | production-only services |

Every non-local server declares matching `APP_ENV`, `DATABASE_ENVIRONMENT`, and
`REDIS_ENVIRONMENT`; S3-compatible storage also declares `OBJECT_STORAGE_ENVIRONMENT`. Mobile and
Admin independently pair public app/API markers. These checks block common cross-environment errors.

The future target is DigitalOcean Singapore. Staging precedes production and uses synthetic/pilot
data. Backup targets are RPO 1 hour and RTO 4 hours; implementation and restore drills are later
work.

Operating assumptions: invitation-only Lucena City and Metro Manila pilot with 5–10 owners, 10–25
vehicles, and 25–50 renters; support 08:00–18:00 Asia/Manila; manual KYC; sandbox-only payments and
payouts; security deposits disabled; booking extensions deferred; alerts to the primary owner;
about PHP 10,000 initial, PHP 6,000 recurring target, PHP 8,000 monthly soft ceiling. Crossing the
ceiling requires review.

When billing is enabled, configure DigitalOcean alerts to the primary owner at 50%, 75%, and 100%
of the PHP 8,000 soft ceiling (using the provider's billing-currency equivalent), plus unexpected
daily-spend and forecast alerts. Actual alerts are a later provisioning action.
