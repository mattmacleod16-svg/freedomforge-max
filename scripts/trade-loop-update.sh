#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-${USER:-$(whoami)}}"
SERVICE_PREFIX="freedomforge-trade-loop"
INSTALL_DEPS="true"
APP_BASE_URL="https://freedomforge-max.vercel.app"
HEALTH_PATH="/api/alchemy/health"
HEALTH_RETRIES="4"
HEALTH_RETRY_DELAY_SEC="3"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --service-prefix)
      SERVICE_PREFIX="$2"; shift 2 ;;
    --install-deps)
      INSTALL_DEPS="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --health-path)
      HEALTH_PATH="$2"; shift 2 ;;
    --health-retries)
      HEALTH_RETRIES="$2"; shift 2 ;;
    --health-retry-delay-sec)
      HEALTH_RETRY_DELAY_SEC="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Git repo not found at --repo-dir=$REPO_DIR" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (systemd service) so service restarts can be applied." >&2
  exit 1
fi

health_check() {
  local health_url="${APP_BASE_URL%/}${HEALTH_PATH}"
  for ((i=1; i<=HEALTH_RETRIES; i++)); do
    if curl --fail --silent --show-error --max-time 15 "$health_url" >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_RETRY_DELAY_SEC"
  done
  return 1
}

roll_back() {
  local rollback_sha="$1"
  echo "Rolling back to $rollback_sha"
  sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git reset --hard '$rollback_sha'"
  if [[ -f "$REPO_DIR/package-lock.json" ]]; then
    sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && npm ci --omit=dev"
  else
    sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && npm install --omit=dev"
  fi
}

if ! health_check; then
  echo "Preflight health check failed; refusing to deploy update" >&2
  exit 1
fi

BRANCH="$(sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git rev-parse --abbrev-ref HEAD")"
if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
  echo "Unable to determine branch in $REPO_DIR" >&2
  exit 1
fi

sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git fetch --prune origin"
LOCAL_SHA="$(sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git rev-parse HEAD")"
REMOTE_SHA="$(sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git rev-parse origin/$BRANCH")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  echo "No updates available for $BRANCH ($LOCAL_SHA)"
  exit 0
fi

echo "Updates detected on $BRANCH: $LOCAL_SHA -> $REMOTE_SHA"
LOCK_BEFORE=""
if [[ -f "$REPO_DIR/package-lock.json" ]]; then
  LOCK_BEFORE="$(sha256sum "$REPO_DIR/package-lock.json" | awk '{print $1}')"
fi

sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && git pull --ff-only origin '$BRANCH'"

if [[ "$INSTALL_DEPS" == "true" ]]; then
  LOCK_AFTER=""
  if [[ -f "$REPO_DIR/package-lock.json" ]]; then
    LOCK_AFTER="$(sha256sum "$REPO_DIR/package-lock.json" | awk '{print $1}')"
  fi

  if [[ -d "$REPO_DIR/node_modules" && "$LOCK_BEFORE" == "$LOCK_AFTER" ]]; then
    echo "Dependencies unchanged; skipping npm install"
  else
    echo "Installing production dependencies"
    if [[ -f "$REPO_DIR/package-lock.json" ]]; then
      sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && npm ci --omit=dev"
    else
      sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$REPO_DIR' && npm install --omit=dev"
    fi
  fi
fi

echo "Restarting trade-loop services"
mapfile -t services < <(systemctl list-unit-files --type=service --no-legend | awk '{print $1}' | grep "^${SERVICE_PREFIX}-" || true)

if [[ "${#services[@]}" -eq 0 ]]; then
  echo "No services found with prefix ${SERVICE_PREFIX}-" >&2
  exit 1
fi

ROLLBACK_SHA="$LOCAL_SHA"

for svc in "${services[@]}"; do
  echo "Restarting $svc"
  systemctl restart "$svc"
  if ! systemctl is-active --quiet "$svc"; then
    echo "Service failed after restart: $svc" >&2
    roll_back "$ROLLBACK_SHA"
    for rb_svc in "${services[@]}"; do
      systemctl restart "$rb_svc" || true
    done
    exit 1
  fi
  if ! health_check; then
    echo "Health check failed after restarting $svc" >&2
    roll_back "$ROLLBACK_SHA"
    for rb_svc in "${services[@]}"; do
      systemctl restart "$rb_svc" || true
    done
    exit 1
  fi
done

if ! health_check; then
  echo "Post-deploy health check failed" >&2
  roll_back "$ROLLBACK_SHA"
  for rb_svc in "${services[@]}"; do
    systemctl restart "$rb_svc" || true
  done
  exit 1
fi

echo "Update complete; restarted ${#services[@]} services"
