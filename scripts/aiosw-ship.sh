#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# AIOSW Ship Script — All In One Ship With Kit
# FreedomForge Max — single-command deploy to any target
#
# Usage:
#   ./scripts/aiosw-ship.sh <target>
#
# Targets:
#   scan      Run secret scan only (no deploy)
#   docker    Build Docker image + run container
#   compose   docker compose up --build -d
#   railway   railway up
#   k8s       kubectl apply -k k8s/
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET="${1:-}"
IMAGE_NAME="freedomforge-max:aiosw"
REQUIRED_VARS=(OPENROUTER_API_KEY SESSION_SECRET)

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[aiosw]${NC} $*"; }
success() { echo -e "${GREEN}[aiosw]${NC} $*"; }
warn()    { echo -e "${YELLOW}[aiosw]${NC} $*"; }
error()   { echo -e "${RED}[aiosw]${NC} $*" >&2; exit 1; }

# ── Secret scan ───────────────────────────────────────────────────────────────
run_secret_scan() {
  info "Running secret scan..."
  local PATTERNS='(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'
  local HITS
  HITS=$(grep -rE "$PATTERNS" \
    --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" \
    --exclude-dir=node_modules --exclude-dir=.next \
    . 2>/dev/null || true)

  if [[ -n "$HITS" ]]; then
    error "Potential secret detected — aborting ship.\n$HITS"
  fi
  success "Secret scan clean."
}

# ── Env validation ────────────────────────────────────────────────────────────
validate_env() {
  local missing=()
  for var in "${REQUIRED_VARS[@]}"; do
    [[ -z "${!var:-}" ]] && missing+=("$var")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing required env vars: ${missing[*]}\nSet them in .env.local before shipping."
  fi
  success "Env vars validated."
}

# ── Load .env.local if present ────────────────────────────────────────────────
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$TARGET" in
  scan)
    run_secret_scan
    ;;

  docker)
    run_secret_scan
    validate_env
    info "Building Docker image: $IMAGE_NAME"
    docker build -t "$IMAGE_NAME" .
    success "Image built: $IMAGE_NAME"
    info "Starting container on port 3000..."
    docker run -d \
      --name freedomforge-aiosw \
      --env-file .env.local \
      -p 3000:3000 \
      "$IMAGE_NAME"
    success "Container running → http://localhost:3000"
    ;;

  compose)
    run_secret_scan
    validate_env
    info "Starting full stack with Docker Compose..."
    docker compose up --build -d
    success "Stack running → http://localhost:3000"
    ;;

  railway)
    run_secret_scan
    validate_env
    info "Deploying to Railway..."
    if ! command -v railway &>/dev/null; then
      error "'railway' CLI not found. Install: npm i -g @railway/cli"
    fi
    railway up
    success "Deployed to Railway."
    ;;

  k8s)
    run_secret_scan
    info "Applying Kubernetes manifests via kustomize..."
    if ! command -v kubectl &>/dev/null; then
      error "'kubectl' not found. Install kubectl before deploying to k8s."
    fi
    kubectl apply -k k8s/
    success "Kubernetes manifests applied."
    kubectl rollout status deployment -n freedomforge-earth --timeout=120s || true
    ;;

  *)
    echo "AIOSW Kit — FreedomForge Max"
    echo ""
    echo "Usage: $0 <target>"
    echo ""
    echo "Targets:"
    echo "  scan      Secret scan only"
    echo "  docker    Build + run Docker container"
    echo "  compose   docker compose up --build -d  (app + redis)"
    echo "  railway   Deploy to Railway"
    echo "  k8s       kubectl apply -k k8s/"
    exit 1
    ;;
esac
