#!/usr/bin/env bash
# scripts/setup-auth-users.sh
# ---------------------------------------------------------------------------
# OPTIONAL helper — create / reset test users in your authentication provider
# before running the E2E suite.
#
# This script is PROVIDER-SPECIFIC and must be adapted to your stack.
# The scaffold ships a no-op template with commented examples.
#
# Usage:
#   ./scripts/setup-auth-users.sh            # create / reset all test users
#   ./scripts/setup-auth-users.sh --dry-run  # print what would happen, no changes
#
# Environment variables consumed (same as .env / CI secrets):
#   E2E_USERNAME           regular test user login
#   E2E_PASSWORD           regular test user initial password
#   E2E_NEW_PASSWORD       regular test user post-reset password (optional)
#   E2E_ADMIN_USERNAME     admin test user login  (optional)
#   E2E_ADMIN_PASSWORD     admin test user initial password (optional)
#   E2E_ADMIN_NEW_PASSWORD admin test user post-reset password (optional)
#
# Add whatever admin-API credentials your provider needs (token, endpoint,
# pool/tenant id, ...) as additional env vars and require_env them below.
# ---------------------------------------------------------------------------
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[setup-auth-users] $*"; }
skip() { echo "[setup-auth-users] DRY RUN — would: $*"; }

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "[setup-auth-users] ERROR: required env var '$var' is not set." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------
require_env E2E_USERNAME
require_env E2E_PASSWORD

# ---------------------------------------------------------------------------
# TODO: implement the create/reset logic for your auth provider below.
#
# EXAMPLE — Generic admin HTTP API (adapt URL, auth, and payload to your stack)
# ----------------------------------------------------------------------------
# require_env AUTH_API_URL
# require_env AUTH_API_TOKEN
#
# create_or_reset_user() {
#   local username="$1"
#   local password="$2"
#
#   if "$DRY_RUN"; then
#     skip "create/reset user '$username'"
#     return
#   fi
#
#   curl -sf -X POST "${AUTH_API_URL}/users" \
#     -H "Authorization: Bearer ${AUTH_API_TOKEN}" \
#     -H "Content-Type: application/json" \
#     -d "{\"username\":\"${username}\",\"password\":\"${password}\"}" \
#     > /dev/null
#
#   log "user '$username' ready"
# }
#
# create_or_reset_user "$E2E_USERNAME" "${E2E_NEW_PASSWORD:-$E2E_PASSWORD}"
# if [[ -n "${E2E_ADMIN_USERNAME:-}" ]]; then
#   create_or_reset_user "$E2E_ADMIN_USERNAME" "${E2E_ADMIN_NEW_PASSWORD:-${E2E_ADMIN_PASSWORD:-}}"
# fi
#
# Other providers expose equivalent admin user-creation APIs or CLIs (managed
# identity services, hosted auth platforms, self-hosted identity servers, ...).
# Call your provider's admin endpoint / CLI from create_or_reset_user above.
# ---------------------------------------------------------------------------

log "No provider configured — edit this script to create your test users."
log "See the commented EXAMPLE block above for guidance."

if "$DRY_RUN"; then
  log "DRY RUN complete. No changes were made."
fi
