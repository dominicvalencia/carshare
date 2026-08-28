#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REQUIRED_NODE_MAJOR="24"
readonly REQUIRED_PNPM_VERSION="11.22.0"
readonly REQUIRED_COREPACK_VERSION="0.34.6"

INSTALL_SYSTEM_DEPENDENCIES=1
RUN_SEED=1
RUN_VERIFY=1
START_APPLICATIONS=0

usage() {
  printf '%s\n' \
    'Usage: bash tooling/setup-new-mac.sh [options]' \
    '' \
    'Idempotently prepares this repository on macOS.' \
    '' \
    'Options:' \
    '  --skip-system-dependencies  Require Node 24, pnpm, and Docker to exist already.' \
    '  --skip-seed                 Apply migrations without loading PSGC/demo seed data.' \
    '  --skip-verify               Skip the CI-equivalent pnpm verify run.' \
    '  --start                     Start API, worker, admin, and Metro after setup.' \
    '  -h, --help                  Show this help.'
}

log() {
  printf '\n==> %s\n' "$1"
}

warn() {
  printf '\nWARNING: %s\n' "$1" >&2
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

for argument in "$@"; do
  case "${argument}" in
    --skip-system-dependencies) INSTALL_SYSTEM_DEPENDENCIES=0 ;;
    --skip-seed) RUN_SEED=0 ;;
    --skip-verify) RUN_VERIFY=0 ;;
    --start) START_APPLICATIONS=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: ${argument}"
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || fail 'This bootstrap script supports macOS only.'
[[ -f "${REPOSITORY_ROOT}/package.json" ]] || fail 'Repository package.json was not found.'
[[ -f "${REPOSITORY_ROOT}/docker-compose.yml" ]] || fail 'docker-compose.yml was not found.'
cd "${REPOSITORY_ROOT}"

log 'Checking Apple development tools'
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  fail 'Finish the Xcode Command Line Tools installer, then run this script again.'
fi

if ! xcrun simctl help >/dev/null 2>&1; then
  warn 'Full Xcode with an iOS Simulator runtime is not ready. Core setup will continue, but install/open Xcode before running iOS.'
fi

if ((INSTALL_SYSTEM_DEPENDENCIES)); then
  command_exists brew || fail 'Homebrew is required for automatic system dependency installation. Install it from https://brew.sh and rerun this script.'

  log 'Preparing NVM and Node.js 24'
  if [[ ! -s "${HOME}/.nvm/nvm.sh" ]] && [[ ! -s "$(brew --prefix nvm 2>/dev/null)/nvm.sh" ]]; then
    brew install nvm
  fi

  export NVM_DIR="${HOME}/.nvm"
  mkdir -p "${NVM_DIR}"
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "${NVM_DIR}/nvm.sh"
  else
    readonly BREW_NVM_DIR="$(brew --prefix nvm)"
    # shellcheck source=/dev/null
    source "${BREW_NVM_DIR}/nvm.sh"
  fi
  nvm install "${REQUIRED_NODE_MAJOR}"
  nvm use "${REQUIRED_NODE_MAJOR}"

  readonly ZSH_CONFIGURATION="${HOME}/.zshrc"
  readonly NVM_MARKER='# Car Rental bootstrap: load NVM'
  if [[ ! -f "${ZSH_CONFIGURATION}" ]] || ! grep -Fq "${NVM_MARKER}" "${ZSH_CONFIGURATION}"; then
    {
      printf '\n%s\n' "${NVM_MARKER}"
      printf '%s\n' 'export NVM_DIR="$HOME/.nvm"'
      printf '%s\n' '[ -s "$(brew --prefix nvm 2>/dev/null)/nvm.sh" ] && \. "$(brew --prefix nvm)/nvm.sh"'
    } >>"${ZSH_CONFIGURATION}"
  fi

  if ! command_exists docker; then
    log 'Installing Docker Desktop'
    brew install --cask docker
  fi
else
  command_exists node || fail 'Node.js is missing. Rerun without --skip-system-dependencies.'
  command_exists docker || fail 'Docker is missing. Rerun without --skip-system-dependencies.'
fi

readonly NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
[[ "${NODE_MAJOR}" == "${REQUIRED_NODE_MAJOR}" ]] || fail "Node ${REQUIRED_NODE_MAJOR}.x is required; found $(node --version)."

log 'Preparing Corepack and pnpm'
if ! command_exists corepack; then
  npm install --global "corepack@${REQUIRED_COREPACK_VERSION}"
fi
corepack enable
corepack prepare "pnpm@${REQUIRED_PNPM_VERSION}" --activate
readonly ACTUAL_PNPM_VERSION="$(pnpm --version)"
[[ "${ACTUAL_PNPM_VERSION}" == "${REQUIRED_PNPM_VERSION}" ]] || fail "Expected pnpm ${REQUIRED_PNPM_VERSION}; found ${ACTUAL_PNPM_VERSION}."

log 'Starting Docker Desktop'
if ! docker info >/dev/null 2>&1; then
  open -a Docker || fail 'Docker Desktop could not be opened.'
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi
docker info >/dev/null 2>&1 || fail 'Docker did not become ready. Open Docker Desktop, resolve its prompt, and rerun.'

log 'Preparing local environment configuration'
if [[ -f .env ]]; then
  printf '%s\n' 'Preserving existing .env.'
else
  cp .env.example .env
  printf '%s\n' 'Created .env from .env.example.'
fi

log 'Installing workspace dependencies'
pnpm install --frozen-lockfile

log 'Generating Prisma client'
pnpm db:generate

log 'Starting PostgreSQL/PostGIS and Redis'
pnpm dev:infra
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready >/dev/null 2>&1 &&
    [[ "$(docker compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" == 'PONG' ]]; then
    break
  fi
  sleep 2
done
docker compose exec -T postgres pg_isready >/dev/null 2>&1 || fail 'PostgreSQL did not become ready.'
[[ "$(docker compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" == 'PONG' ]] || fail 'Redis did not become ready.'
docker compose ps

log 'Applying committed database migrations'
pnpm db:migrate:deploy

if ((RUN_SEED)); then
  log 'Synchronizing PSGC data and seeding local pilot accounts'
  pnpm db:seed
else
  warn 'Seed skipped. PSGC reference and demo accounts may be unavailable.'
fi

if ((RUN_VERIFY)); then
  log 'Running CI-equivalent verification'
  pnpm verify
  log 'Running PostgreSQL integration tests'
  pnpm test:integration
else
  warn 'Verification skipped. Run pnpm verify and pnpm test:integration before relying on this installation.'
fi

log 'Setup complete'
printf '%s\n' \
  'Admin:  http://localhost:3001' \
  'API:    http://localhost:3000/api/v1/health' \
  'Swagger:http://localhost:3000/docs' \
  'Metro:  http://localhost:8081' \
  '' \
  'Demo password: CarRentalDemo2026!' \
  'Renter:        renter@demo.carrental.ph' \
  'Owner:         owner@demo.carrental.ph' \
  'Dual role:     dualrole@demo.carrental.ph'

if ((START_APPLICATIONS)); then
  log 'Starting API, worker, admin, and Metro; press Control-C to stop'
  exec pnpm dev
fi

printf '\nRun pnpm dev when you are ready to start all applications.\n'
