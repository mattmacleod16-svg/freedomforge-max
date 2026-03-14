#!/usr/bin/env bash
set -euo pipefail

# Oracle VM bootstrap for always-on trade-loop services.
# This script installs Node.js + git, clones/updates repo, installs deps,
# then installs and starts systemd services that survive reboots.

REPO_URL=""
INSTALL_DIR="$HOME/freedomforge-max"
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
INSTALL_AUTO_UPDATE="true"
AUTO_UPDATE_ON_CALENDAR="*-*-* 03:15:00"
AUTO_UPDATE_RANDOM_DELAY_SEC="0"
INSTALL_INTELLIGENCE_MAINTAIN="true"
INTELLIGENCE_ON_CALENDAR="*-*-* 00,06,12,18:45:00"
INTELLIGENCE_RANDOM_DELAY_SEC="0"
INTELLIGENCE_TIMEOUT_SEC="1800"
INSTALL_CLOB_BURNIN="true"
CLOB_BURNIN_ON_CALENDAR="*-*-* 23:55:00"
CLOB_BURNIN_RANDOM_DELAY_SEC="0"
CLOB_BURNIN_LOOKBACK_HOURS="24"
CLOB_BURNIN_MIN_RUNS="1"
CLOB_BURNIN_SKIP_THRESHOLD="4"
CLOB_BURNIN_ERROR_THRESHOLD="1"
CLOB_BURNIN_WARN_STREAK_THRESHOLD="2"
CLOB_BURNIN_AUTO_PATCH_ON_WARN_STREAK="true"
CLOB_BURNIN_HEALTH_STREAK_THRESHOLD="3"
CLOB_BURNIN_AUTO_RESTORE_ON_HEALTH_STREAK="true"
INSTALL_SUPERAGENT_SELFTEST="true"
SUPERAGENT_SELFTEST_ON_CALENDAR="Sun *-*-* 04:30:00"
SUPERAGENT_SELFTEST_RANDOM_DELAY_SEC="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="$2"; shift 2 ;;
    --dir)
      INSTALL_DIR="$2"; shift 2 ;;
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
    --install-auto-update)
      INSTALL_AUTO_UPDATE="$2"; shift 2 ;;
    --auto-update-on-calendar)
      AUTO_UPDATE_ON_CALENDAR="$2"; shift 2 ;;
    --auto-update-random-delay-sec)
      AUTO_UPDATE_RANDOM_DELAY_SEC="$2"; shift 2 ;;
    --install-intelligence-maintain)
      INSTALL_INTELLIGENCE_MAINTAIN="$2"; shift 2 ;;
    --intelligence-on-calendar)
      INTELLIGENCE_ON_CALENDAR="$2"; shift 2 ;;
    --intelligence-random-delay-sec)
      INTELLIGENCE_RANDOM_DELAY_SEC="$2"; shift 2 ;;
    --intelligence-timeout-sec)
      INTELLIGENCE_TIMEOUT_SEC="$2"; shift 2 ;;
    --install-clob-burnin)
      INSTALL_CLOB_BURNIN="$2"; shift 2 ;;
    --clob-burnin-on-calendar)
      CLOB_BURNIN_ON_CALENDAR="$2"; shift 2 ;;
    --clob-burnin-random-delay-sec)
      CLOB_BURNIN_RANDOM_DELAY_SEC="$2"; shift 2 ;;
    --clob-burnin-lookback-hours)
      CLOB_BURNIN_LOOKBACK_HOURS="$2"; shift 2 ;;
    --clob-burnin-min-runs)
      CLOB_BURNIN_MIN_RUNS="$2"; shift 2 ;;
    --clob-burnin-skip-threshold)
      CLOB_BURNIN_SKIP_THRESHOLD="$2"; shift 2 ;;
    --clob-burnin-error-threshold)
      CLOB_BURNIN_ERROR_THRESHOLD="$2"; shift 2 ;;
    --clob-burnin-warn-streak-threshold)
      CLOB_BURNIN_WARN_STREAK_THRESHOLD="$2"; shift 2 ;;
    --clob-burnin-auto-patch-on-warn-streak)
      CLOB_BURNIN_AUTO_PATCH_ON_WARN_STREAK="$2"; shift 2 ;;
    --clob-burnin-health-streak-threshold)
      CLOB_BURNIN_HEALTH_STREAK_THRESHOLD="$2"; shift 2 ;;
    --clob-burnin-auto-restore-on-health-streak)
      CLOB_BURNIN_AUTO_RESTORE_ON_HEALTH_STREAK="$2"; shift 2 ;;
    --install-superagent-selftest)
      INSTALL_SUPERAGENT_SELFTEST="$2"; shift 2 ;;
    --superagent-selftest-on-calendar)
      SUPERAGENT_SELFTEST_ON_CALENDAR="$2"; shift 2 ;;
    --superagent-selftest-random-delay-sec)
      SUPERAGENT_SELFTEST_RANDOM_DELAY_SEC="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. Run this on Ubuntu/Debian VM with systemd." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

echo "Installing OS prerequisites"
if command -v apt >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y ca-certificates curl gnupg git
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf -y install ca-certificates curl git --setopt=install_weak_deps=False --setopt=keepcache=0
elif command -v yum >/dev/null 2>&1; then
  sudo yum -y install ca-certificates curl git
else
  echo "No supported package manager found (apt/dnf/yum)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Installing Node.js 20"
  if command -v apt >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf -y install nodejs --setopt=install_weak_deps=False --setopt=keepcache=0
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum -y install nodejs
  else
    echo "Unable to install Node.js automatically; unsupported package manager." >&2
    exit 1
  fi
fi

if [[ -n "$REPO_URL" ]]; then
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "Repo already exists at $INSTALL_DIR; pulling latest"
    sudo -u "$SERVICE_USER" /bin/bash -lc "cd '$INSTALL_DIR' && git pull --ff-only"
  else
    echo "Cloning repo into $INSTALL_DIR"
    sudo -u "$SERVICE_USER" /bin/bash -lc "git clone '$REPO_URL' '$INSTALL_DIR'"
  fi
else
  if [[ -f "$PWD/package.json" && -f "$PWD/scripts/install-trade-loop-services.sh" ]]; then
    INSTALL_DIR="$PWD"
  elif [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "Using existing repo at $INSTALL_DIR"
  else
    echo "No --repo provided and no repo found at current dir or --dir ($INSTALL_DIR)." >&2
    echo "Provide --repo https://github.com/<owner>/<repo>.git" >&2
    exit 1
  fi
fi

if [[ ! -f "$INSTALL_DIR/scripts/install-trade-loop-services.sh" ]]; then
  echo "Missing installer script at $INSTALL_DIR/scripts/install-trade-loop-services.sh" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/scripts/install-trade-loop-autoupdate.sh" ]]; then
  echo "Missing installer script at $INSTALL_DIR/scripts/install-trade-loop-autoupdate.sh" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/scripts/install-trade-loop-intelligence.sh" ]]; then
  echo "Missing installer script at $INSTALL_DIR/scripts/install-trade-loop-intelligence.sh" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/scripts/install-trade-loop-clob-burnin.sh" ]]; then
  echo "Missing installer script at $INSTALL_DIR/scripts/install-trade-loop-clob-burnin.sh" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/scripts/install-superagent-selftest.sh" ]]; then
  echo "Missing installer script at $INSTALL_DIR/scripts/install-superagent-selftest.sh" >&2
  exit 1
fi

echo "Installing and starting persistent trade-loop services"
cd "$INSTALL_DIR"
sudo bash scripts/install-trade-loop-services.sh \
  --repo-dir "$INSTALL_DIR" \
  --app-base-url "$APP_BASE_URL" \
  --user "$SERVICE_USER" \
  --interval-ms "$INTERVAL_MS" \
  --success-cooldown-ms "$SUCCESS_COOLDOWN_MS" \
  --jitter-ms "$JITTER_MS" \
  --max-interval-ms "$MAX_INTERVAL_MS" \
  --backoff-factor "$BACKOFF_FACTOR" \
  --request-timeout-ms "$REQUEST_TIMEOUT_MS" \
  --health-every "$HEALTH_EVERY" \
  --shard-phase-ms "$SHARD_PHASE_MS" \
  --install-deps true

if [[ "$INSTALL_AUTO_UPDATE" == "true" ]]; then
  echo "Installing nightly auto-update timer"
  sudo bash scripts/install-trade-loop-autoupdate.sh \
    --repo-dir "$INSTALL_DIR" \
    --user "$SERVICE_USER" \
    --on-calendar "$AUTO_UPDATE_ON_CALENDAR" \
    --random-delay-sec "$AUTO_UPDATE_RANDOM_DELAY_SEC" \
    --persistent true
fi

if [[ "$INSTALL_INTELLIGENCE_MAINTAIN" == "true" ]]; then
  echo "Installing intelligence maintenance timer"
  sudo bash scripts/install-trade-loop-intelligence.sh \
    --repo-dir "$INSTALL_DIR" \
    --user "$SERVICE_USER" \
    --app-base-url "$APP_BASE_URL" \
    --on-calendar "$INTELLIGENCE_ON_CALENDAR" \
    --random-delay-sec "$INTELLIGENCE_RANDOM_DELAY_SEC" \
    --persistent true \
    --timeout-sec "$INTELLIGENCE_TIMEOUT_SEC"
fi

if [[ "$INSTALL_CLOB_BURNIN" == "true" ]]; then
  echo "Installing CLOB burn-in check timer"
  sudo bash scripts/install-trade-loop-clob-burnin.sh \
    --repo-dir "$INSTALL_DIR" \
    --user "$SERVICE_USER" \
    --on-calendar "$CLOB_BURNIN_ON_CALENDAR" \
    --random-delay-sec "$CLOB_BURNIN_RANDOM_DELAY_SEC" \
    --persistent true \
    --lookback-hours "$CLOB_BURNIN_LOOKBACK_HOURS" \
    --min-runs "$CLOB_BURNIN_MIN_RUNS" \
    --skip-threshold "$CLOB_BURNIN_SKIP_THRESHOLD" \
    --error-threshold "$CLOB_BURNIN_ERROR_THRESHOLD" \
    --warn-streak-threshold "$CLOB_BURNIN_WARN_STREAK_THRESHOLD" \
    --auto-patch-on-warn-streak "$CLOB_BURNIN_AUTO_PATCH_ON_WARN_STREAK" \
    --health-streak-threshold "$CLOB_BURNIN_HEALTH_STREAK_THRESHOLD" \
    --auto-restore-on-health-streak "$CLOB_BURNIN_AUTO_RESTORE_ON_HEALTH_STREAK"
fi

if [[ "$INSTALL_SUPERAGENT_SELFTEST" == "true" ]]; then
  echo "Installing superagent weekly self-test timer"
  sudo bash scripts/install-superagent-selftest.sh \
    --repo-dir "$INSTALL_DIR" \
    --user "$SERVICE_USER" \
    --app-base-url "$APP_BASE_URL" \
    --on-calendar "$SUPERAGENT_SELFTEST_ON_CALENDAR" \
    --random-delay-sec "$SUPERAGENT_SELFTEST_RANDOM_DELAY_SEC" \
    --persistent true
fi

echo
echo "✅ Oracle VM trade-loop bootstrap complete"
echo "Services are enabled and restart automatically on reboot/crash."
echo "Quick checks:"
echo "  systemctl list-units --type=service | grep freedomforge-trade-loop"
echo "  journalctl -u freedomforge-trade-loop-eth-shard0.service -f"
if [[ "$INSTALL_AUTO_UPDATE" == "true" ]]; then
  echo "  systemctl list-timers freedomforge-trade-loop-update.timer --no-pager"
fi
if [[ "$INSTALL_INTELLIGENCE_MAINTAIN" == "true" ]]; then
  echo "  systemctl list-timers freedomforge-trade-loop-intelligence.timer --no-pager"
fi
if [[ "$INSTALL_CLOB_BURNIN" == "true" ]]; then
  echo "  systemctl list-timers freedomforge-trade-loop-clob-burnin.timer --no-pager"
fi
if [[ "$INSTALL_SUPERAGENT_SELFTEST" == "true" ]]; then
  echo "  systemctl list-timers freedomforge-superagent-selftest.timer --no-pager"
fi
