# New Mac development setup

This guide prepares a clean macOS machine to run the complete Car Rental development environment.
It assumes access to the private `dominicvalencia/carshare` GitHub repository. Local Docker data,
uploaded development objects, simulator state, and `.env` are intentionally not stored in Git; a new
Mac starts with a fresh seeded development database unless those items are migrated separately.

## Toolchain baseline

Use the versions declared by the repository rather than upgrading individual packages during setup:

| Tool                    | Required baseline                                    |
| ----------------------- | ---------------------------------------------------- |
| macOS development tools | Xcode plus Xcode Command Line Tools                  |
| Node.js                 | 24.x (`.nvmrc`)                                      |
| pnpm                    | 11.22.0 (`packageManager` in `package.json`)         |
| Mobile                  | Expo SDK 54, React Native 0.81.5                     |
| Infrastructure          | Docker Compose, PostgreSQL 17/PostGIS 3.5, Redis 7.4 |

Android development additionally requires Android Studio, an Android SDK, and an emulator or a USB
device with debugging enabled.

## 1. Install macOS prerequisites

For the recommended automated path, install Xcode and Homebrew in this section, then continue with
GitHub SSH and cloning. The repository script installs NVM, Node, pnpm, and Docker Desktop when they are
missing. The remaining commands in this section document the manual alternative.

### Xcode

Install and open Xcode once, accept its license, and install at least one iOS Simulator runtime from
**Xcode → Settings → Components**. Then install or confirm the command-line tools:

```bash
xcode-select --install
xcodebuild -version
xcrun simctl list devices available
```

If more than one Xcode installation exists, select the intended one:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### Homebrew

Install Homebrew from <https://brew.sh> and verify it is available:

```bash
brew --version
```

The bootstrap deliberately does not execute a remote Homebrew installer with elevated privileges.

### Manual toolchain alternative

Skip this subsection when using `bash tooling/setup-new-mac.sh` after cloning.

Install Docker Desktop for Mac, open it, wait for the engine to start, and verify:

```bash
docker version
docker compose version
docker info
```

Install NVM using its official instructions, then install the repository Node version:

```bash
nvm install 24
nvm use 24
node --version
```

Enable Corepack and activate the pinned pnpm release:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm --version
```

Expected major versions are Node 24 and pnpm 11.

## 2. Configure GitHub SSH access

Check for an existing public key:

```bash
ls ~/.ssh/id_ed25519.pub
```

If it does not exist, create a dedicated Ed25519 key, substituting the email attached to the GitHub
account:

```bash
ssh-keygen -t ed25519 -C "your-github-email@example.com"
```

Load the identity into the macOS Keychain and copy its public half:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
pbcopy < ~/.ssh/id_ed25519.pub
```

Add the copied value at <https://github.com/settings/ssh/new>, then verify authentication:

```bash
ssh -T git@github.com
```

GitHub should identify the signed-in username. Its message that shell access is unavailable is normal.
After a restart, if the key is not being offered, reload it with:

```bash
ssh-add --apple-load-keychain
```

## 3. Clone the private repository

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone git@github.com:dominicvalencia/carshare.git carrental
cd carrental
git status --short --branch
```

The initial branch should be `main` and track `origin/main`.

## 4. Create the local environment

### Recommended automated setup

After the prerequisites and clone steps above, the repository bootstrap can perform the remaining
toolchain and project setup idempotently:

```bash
bash tooling/setup-new-mac.sh
```

It installs NVM/Node 24 and Docker Desktop through an existing Homebrew installation when needed,
preserves an existing `.env`, installs the frozen workspace, starts infrastructure, generates Prisma,
applies migrations, seeds the database, and runs `pnpm verify` plus the PostgreSQL integration suite.
To start every application after the checks pass:

```bash
bash tooling/setup-new-mac.sh --start
```

Available exceptions are `--skip-system-dependencies`, `--skip-seed`, and `--skip-verify`; use them only
when the corresponding step was deliberately completed elsewhere. Full Xcode/App Store installation,
GitHub account authorization, and the initial private clone remain manual security/account steps.

The following sections document each automated operation individually for review and troubleshooting.

Create the ignored local environment file from the committed example:

```bash
cp .env.example .env
```

The defaults use local-only fake payment, payout, push, and authentication-delivery providers. Never
reuse these secrets or provider settings in a shared, staging, or production environment. Do not copy
the old Mac's `.env` unless it contains intentional local overrides that have been reviewed for secrets.

Optional: to seed a local administrator, temporarily set the following in `.env` before seeding:

```dotenv
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=replace-with-at-least-12-characters
```

After the seed succeeds, remove the plaintext seed password from `.env`. The local administrator record
remains in PostgreSQL.

## 5. Install dependencies

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
```

Do not run an unscoped Expo, React Native, Prisma, or pnpm upgrade as part of machine setup. Dependency
changes must be reviewed through the workspace lockfile and verified on both mobile exports.

## 6. Start and prepare local infrastructure

Start PostgreSQL/PostGIS and Redis:

```bash
pnpm dev:infra
docker compose ps
```

Wait until both services report `healthy`, then apply all committed migrations and seed PSGC reference
data plus the local pilot accounts:

```bash
pnpm db:migrate:deploy
pnpm db:seed
```

`pnpm db:seed` is idempotent and runs the bundled PSGC synchronization before the application seed.
Confirm the schema if needed:

```bash
pnpm --filter @carrental/database exec prisma migrate status
```

## 7. Start the applications

Start the API, workers, admin portal, and Metro together:

```bash
pnpm dev
```

Keep that terminal open. The local endpoints are:

| Service      | URL                                   |
| ------------ | ------------------------------------- |
| Admin portal | <http://localhost:3001>               |
| API health   | <http://localhost:3000/api/v1/health> |
| Swagger      | <http://localhost:3000/docs>          |
| Metro        | <http://localhost:8081>               |
| PostgreSQL   | `localhost:5432`                      |
| Redis        | `localhost:6379`                      |

For clearer logs, the host applications can instead run in separate terminals:

```bash
pnpm --filter @carrental/api dev
pnpm --filter @carrental/workers dev
pnpm --filter @carrental/admin-web dev
pnpm --filter @carrental/mobile dev
```

## 8. Run the iOS application

Open an installed simulator and start the SDK 54 project:

```bash
open -a Simulator
pnpm --filter @carrental/mobile dev
```

Press `i` in the Expo terminal, or open the displayed `exp://` URL from a compatible Expo Go client.
The project requires an Expo Go client that supports SDK 54. If the current App Store client no longer
supports SDK 54, use a compatible SDK 54 client or create an SDK 54 development build; do not upgrade
the repository dependency matrix solely to bypass that client mismatch.

The default `EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1` works in an iOS Simulator because the
simulator can reach the Mac loopback interface.

## 9. Run on a physical device

The phone and Mac must be on the same LAN. Find the Mac's LAN address and replace `localhost` in the
mobile API setting inside `.env`, for example:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api/v1
```

Restart Metro after changing an `EXPO_PUBLIC_` value:

```bash
pnpm --filter @carrental/mobile dev -- --lan --clear
```

Allow incoming Node/Expo connections in the macOS firewall when prompted. Verify the API from the
phone's browser with `http://MAC_LAN_IP:3000/api/v1/health` before scanning the Metro QR code. A physical
device must not use `localhost` for the Mac API.

For the standard Android emulator, use `http://10.0.2.2:3000/api/v1` when it cannot resolve the Mac
through `localhost`.

## 10. Local pilot accounts

After `pnpm db:seed`:

| Mode           | Email                        | Password             |
| -------------- | ---------------------------- | -------------------- |
| Renter         | `renter@demo.carrental.ph`   | `CarRentalDemo2026!` |
| Verified owner | `owner@demo.carrental.ph`    | `CarRentalDemo2026!` |
| Dual role      | `dualrole@demo.carrental.ph` | `CarRentalDemo2026!` |

New registrations remain unverified. In a development build, use **Profile → Verification → Open local
verification inbox** to retrieve only that signed-in account's in-memory email token and mobile OTP.
This viewer requires `APP_ENV=local` or `test` and `AUTH_DELIVERY_PROVIDER=development`; production
configuration rejects it.

## 11. Verify the installation

Run the CI-equivalent checks and the database-backed integration suite:

```bash
pnpm verify
pnpm test:integration
git diff --check
```

`pnpm verify` covers formatting, Compose validation, lint, typechecking, unit/E2E tests, Prisma schema
validation, all package/application builds, and iOS plus Android Expo exports. Integration tests use the
separate `carrental_test` database from `.env` and reseed their own fixtures.

Useful smoke checks:

```bash
curl http://localhost:3000/api/v1/health
curl --head http://localhost:3001
curl http://localhost:8081/status
docker compose ps
```

## 12. Normal shutdown and restart

Stop `pnpm dev` with **Control-C**. Stop infrastructure without deleting local data:

```bash
pnpm dev:infra:down
```

On the next work session:

```bash
cd ~/Documents/carrental
nvm use
pnpm dev:infra
pnpm dev
```

Run `pnpm db:migrate:deploy` after pulling commits that contain new migrations.

## Troubleshooting

### GitHub says `Repository not found`

GitHub returns that message when an HTTPS client is unauthenticated for a private repository. Confirm
the SSH remote and identity:

```bash
git remote -v
ssh-add --apple-load-keychain
ssh -T git@github.com
```

The remote should be `git@github.com:dominicvalencia/carshare.git`.

### Docker or Prisma cannot connect

Open Docker Desktop, wait for `docker info` to succeed, and confirm both containers are healthy:

```bash
pnpm dev:infra
docker compose ps
pnpm db:migrate:deploy
```

### A development port is already in use

```bash
lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:8081 -sTCP:LISTEN
```

Reuse the existing process when it belongs to this repository, or stop that specific process before
restarting. Do not start Metro on an arbitrary replacement port unless the device URL is updated too.

### Expo reports an incompatible SDK

Confirm the checked-out mobile manifest still declares Expo SDK 54 and the client reports SDK 54
support. Run `pnpm install --frozen-lockfile`; do not mix dependencies from SDK 55 into the install.

### The physical device spins and then reports an error

Confirm Metro was started with `--lan`, the phone can open the API health URL using the Mac's LAN IP,
VPN/proxy isolation is disabled, both devices use the same network, and the macOS firewall permits the
connection.

## Data that does not move through Git

- `.env` local overrides and secrets
- Docker PostgreSQL and Redis named volumes
- `.data/objects` development uploads
- Expo Go installations and simulator/device state
- SSH private keys and macOS Keychain entries

For ordinary development, regenerate this state with `.env.example`, migrations, and `pnpm db:seed`.
Back up and restore Docker volumes or development uploads only when the exact old local state is
required; those operations are separate from repository setup and should be handled deliberately.
