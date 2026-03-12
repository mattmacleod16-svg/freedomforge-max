#!/usr/bin/env bash
set -euo pipefail

# Installs the FreedomForge Dashboard API as a systemd service.
# Usage: sudo bash scripts/install-dashboard-api.sh [--repo-dir /path] [--user opc] [--port 9091]
#
# This starts scripts/dashboard-api.js on the specified port, exposing REST + SSE
# endpoints for the native iOS/macOS FreedomForge Monitor app.

REPO_DIR="${PWD}"
SERVICE_USER="${SUDO_USER:-$USER}"
DASHBOARD_PORT="9091"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --port)
      DASHBOARD_PORT="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/scripts/dashboard-api.js" ]]; then
  echo "dashboard-api.js not found in $REPO_DIR/scripts/" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. This installer must run on a systemd host." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

# ── Find Node.js ──────────────────────────────────────────────────────────────
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if [[ -z "$NODE_BIN" ]]; then
  USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6 || true)"
  if [[ -z "$USER_HOME" ]]; then
    USER_HOME="/home/$SERVICE_USER"
  fi
  if [[ -x "$USER_HOME/.local/node20/bin/node" ]]; then
    NODE_BIN="$USER_HOME/.local/node20/bin/node"
  fi
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found. Install Node.js first." >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"

# ── Resolve .env.local for ALERT_SECRET ───────────────────────────────────────
ENV_FILE_LINE=""
if [[ -f "$REPO_DIR/.env.local" ]]; then
  ENV_FILE_LINE="EnvironmentFile=$REPO_DIR/.env.local"
fi

# ── Write systemd service ────────────────────────────────────────────────────
SVC_NAME="ff-dashboard-api"
SVC_PATH="/etc/systemd/system/${SVC_NAME}.service"

echo "Writing ${SVC_PATH}"
sudo tee "$SVC_PATH" >/dev/null <<EOF
[Unit]
Description=FreedomForge Dashboard API (REST + SSE for mobile monitor)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${REPO_DIR}
Environment=PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NODE_BIN=${NODE_BIN}
Environment=DASHBOARD_PORT=${DASHBOARD_PORT}
${ENV_FILE_LINE}
ExecStart=${NODE_BIN} ${REPO_DIR}/scripts/dashboard-api.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

# ── Enable + start ────────────────────────────────────────────────────────────
echo "Reloading systemd daemon"
sudo systemctl daemon-reload
sudo systemctl enable --now "${SVC_NAME}.service"

# ── Verify ────────────────────────────────────────────────────────────────────
sleep 2
if systemctl is-active --quiet "${SVC_NAME}.service"; then
  echo ""
  echo "Dashboard API installed and running on port ${DASHBOARD_PORT}"
  echo ""
  echo "Check status:"
  echo "  systemctl status ${SVC_NAME} --no-pager"
  echo ""
  echo "View logs:"
  echo "  journalctl -u ${SVC_NAME} -f"
  echo ""
  echo "Test from your Mac:"
  echo "  curl http://YOUR_VM_IP:${DASHBOARD_PORT}/api/health"
else
  echo "Service failed to start:" >&2
  sudo systemctl --no-pager --full status "${SVC_NAME}.service" || true
  exit 1
fi
