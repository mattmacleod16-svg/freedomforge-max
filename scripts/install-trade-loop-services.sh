#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${PWD}"
APP_BASE_URL="https://freedomforge-max.up.railway.app"
SERVICE_USER="${SUDO_USER:-$USER}"
INTERVAL_MS="1000"
SUCCESS_COOLDOWN_MS="8000"
JITTER_MS="200"
MAX_INTERVAL_MS="10000"
BACKOFF_FACTOR="1.35"
REQUEST_TIMEOUT_MS="12000"
HEALTH_EVERY="30"
SHARD_PHASE_MS="300"
INSTALL_DEPS="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --interval-ms)
      INTERVAL_MS="$2"; shift 2 ;;
    --success-cooldown-ms)
      SUCCESS_COOLDOWN_MS="$2"; shift 2 ;;
    --jitter-ms)
      JITTER_MS="$2"; shift 2 ;;
    --max-interval-ms)
      MAX_INTERVAL_MS="$2"; shift 2 ;;
    --backoff-factor)
      BACKOFF_FACTOR="$2"; shift 2 ;;
    --request-timeout-ms)
      REQUEST_TIMEOUT_MS="$2"; shift 2 ;;
    --health-every)
      HEALTH_EVERY="$2"; shift 2 ;;
    --shard-phase-ms)
      SHARD_PHASE_MS="$2"; shift 2 ;;
    --install-deps)
      INSTALL_DEPS="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/package.json" ]]; then
  echo "package.json not found in --repo-dir=$REPO_DIR" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. This installer must run on a systemd host (Ubuntu VM)." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

NODE_BIN=""
NPM_BIN=""

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
fi

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  USER_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6 || true)"
  if [[ -z "$USER_HOME" ]]; then
    USER_HOME="/home/$SERVICE_USER"
  fi

  if [[ -x "$USER_HOME/.local/node20/bin/node" && -x "$USER_HOME/.local/node20/bin/npm" ]]; then
    NODE_BIN="$USER_HOME/.local/node20/bin/node"
    NPM_BIN="$USER_HOME/.local/node20/bin/npm"
  fi
fi

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "node/npm not found. Install Node.js first (system-wide or $SERVICE_USER/.local/node20)." >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"

if [[ "$INSTALL_DEPS" == "true" ]]; then
  echo "Installing Node dependencies in $REPO_DIR"
  if [[ -f "$REPO_DIR/package-lock.json" ]]; then
    sudo -u "$SERVICE_USER" /bin/bash -lc "export PATH='$NODE_DIR':\$PATH; cd '$REPO_DIR' && '$NPM_BIN' ci --omit=dev"
  else
    sudo -u "$SERVICE_USER" /bin/bash -lc "export PATH='$NODE_DIR':\$PATH; cd '$REPO_DIR' && '$NPM_BIN' install --omit=dev"
  fi
fi

SERVICE_PREFIX="freedomforge-trade-loop"
SERVICES=(
  "eth-shard0|eth-mainnet|2|0|eth-0"
  "eth-shard1|eth-mainnet|2|1|eth-1"
  "op|opt-mainnet|1|0|op-0"
  "arb|arb-mainnet|1|0|arb-0"
  "pol|polygon-mainnet|1|0|pol-0"
)

make_service() {
  local name="$1"
  local network="$2"
  local shards="$3"
  local shard_index="$4"
  local bot_id="$5"
  local svc="${SERVICE_PREFIX}-${name}.service"
  local path="/etc/systemd/system/${svc}"

  sudo tee "$path" >/dev/null <<EOF
[Unit]
Description=FreedomForge Trade Loop (${name})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${REPO_DIR}
Environment=PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NODE_BIN=${NODE_BIN}
Environment=NPM_BIN=${NPM_BIN}
Environment=APP_BASE_URL=${APP_BASE_URL}
Environment=TRADE_LOOP_INTERVAL_MS=${INTERVAL_MS}
Environment=TRADE_LOOP_SUCCESS_COOLDOWN_MS=${SUCCESS_COOLDOWN_MS}
Environment=TRADE_LOOP_JITTER_MS=${JITTER_MS}
Environment=TRADE_LOOP_MAX_INTERVAL_MS=${MAX_INTERVAL_MS}
Environment=TRADE_LOOP_SKIP_BACKOFF_FACTOR=${BACKOFF_FACTOR}
Environment=TRADE_LOOP_REQUEST_TIMEOUT_MS=${REQUEST_TIMEOUT_MS}
Environment=TRADE_LOOP_HEALTH_EVERY=${HEALTH_EVERY}
Environment=TRADE_LOOP_SHARD_PHASE_MS=${SHARD_PHASE_MS}
Environment=TRADE_LOOP_NETWORK=${network}
Environment=BOT_SHARDS=${shards}
Environment=BOT_SHARD_INDEX=${shard_index}
Environment=BOT_ID=${bot_id}
ExecStart=/bin/bash -lc '"$NPM_BIN" run trade:loop'
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
}

echo "Writing systemd services to /etc/systemd/system"
for item in "${SERVICES[@]}"; do
  IFS='|' read -r name network shards shard_index bot_id <<< "$item"
  make_service "$name" "$network" "$shards" "$shard_index" "$bot_id"
done

echo "Reloading daemon + enabling services"
sudo systemctl daemon-reload

for item in "${SERVICES[@]}"; do
  IFS='|' read -r name _ <<< "$item"
  sudo systemctl enable --now "${SERVICE_PREFIX}-${name}.service"
done

echo "Verifying service states"
for item in "${SERVICES[@]}"; do
  IFS='|' read -r name _ <<< "$item"
  svc="${SERVICE_PREFIX}-${name}.service"
  if ! systemctl is-active --quiet "$svc"; then
    echo "Service failed to start: $svc" >&2
    sudo systemctl --no-pager --full status "$svc" || true
    exit 1
  fi
done

echo
echo "✅ Trade loop services installed and started"
echo "Check status:"
echo "  systemctl status ${SERVICE_PREFIX}-eth-shard0.service --no-pager"
echo "  systemctl status ${SERVICE_PREFIX}-eth-shard1.service --no-pager"
echo "  systemctl status ${SERVICE_PREFIX}-op.service --no-pager"
echo "  systemctl status ${SERVICE_PREFIX}-arb.service --no-pager"
echo "  systemctl status ${SERVICE_PREFIX}-pol.service --no-pager"
echo
echo "Tail logs:"
echo "  journalctl -u ${SERVICE_PREFIX}-eth-shard0.service -f"
echo "  journalctl -u ${SERVICE_PREFIX}-eth-shard1.service -f"
echo "  journalctl -u ${SERVICE_PREFIX}-op.service -f"
echo "  journalctl -u ${SERVICE_PREFIX}-arb.service -f"
echo "  journalctl -u ${SERVICE_PREFIX}-pol.service -f"
