#!/usr/bin/env bash
set -euo pipefail

# Oracle Free VM bootstrap for FreedomForge monitoring stack
#
# Usage:
#   bash scripts/oracle-bootstrap.sh \
#     --domain metrics.example.com \
#     --email you@example.com \
#     --grafana-user admin \
#     --grafana-pass 'StrongPass123!'
#
# Optional:
#   --repo https://github.com/<owner>/<repo>.git
#   --dir /opt/freedomforge-max
#   --auth-hash '$2a$...'   # optional Caddy basicauth bcrypt hash

DOMAIN=""
EMAIL=""
GRAFANA_USER="admin"
GRAFANA_PASS="admin"
REPO_URL=""
INSTALL_DIR="$HOME/freedomforge-max"
AUTH_HASH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="$2"; shift 2 ;;
    --email)
      EMAIL="$2"; shift 2 ;;
    --grafana-user)
      GRAFANA_USER="$2"; shift 2 ;;
    --grafana-pass)
      GRAFANA_PASS="$2"; shift 2 ;;
    --repo)
      REPO_URL="$2"; shift 2 ;;
    --dir)
      INSTALL_DIR="$2"; shift 2 ;;
    --auth-hash)
      AUTH_HASH="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Missing required args. Example:" >&2
  echo "  bash scripts/oracle-bootstrap.sh --domain metrics.example.com --email you@example.com --grafana-pass 'StrongPass123!'" >&2
  exit 1
fi

if [[ -z "$REPO_URL" ]]; then
  echo "No --repo provided. Assuming script is run from an existing cloned repo."
else
  echo "Cloning repo into $INSTALL_DIR"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "Repo already exists at $INSTALL_DIR; skipping clone"
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

if [[ ! -f "monitoring/docker-compose.yml" ]]; then
  echo "monitoring/docker-compose.yml not found. Run this script from the repo root or pass --repo." >&2
  exit 1
fi

echo "Installing Docker + Compose (Ubuntu/Debian)"
sudo apt update
sudo apt install -y ca-certificates curl gnupg ufw
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER" || true

echo "Configuring local firewall"
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 9090/tcp || true
sudo ufw --force enable || true

echo "Writing monitoring/.env"
cat > monitoring/.env <<EOF
GRAFANA_ADMIN_USER=${GRAFANA_USER}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PASS}
CADDY_DOMAIN=${DOMAIN}
CADDY_EMAIL=${EMAIL}
CADDY_BASICAUTH_HASH=${AUTH_HASH}
EOF

echo "Starting monitoring stack"
cd monitoring
sudo docker compose up -d

PUBLIC_IP=$(curl -fsSL https://api.ipify.org || true)

echo
echo "✅ Bootstrap complete"
echo "Grafana URL: https://${DOMAIN}"
if [[ -n "$PUBLIC_IP" ]]; then
  echo "Detected public IP: ${PUBLIC_IP}"
fi
echo "Next:"
echo "1) Ensure DNS A record points ${DOMAIN} -> VM public IP"
echo "2) Set Vercel env NEXT_PUBLIC_GRAFANA_EMBED_URL=https://${DOMAIN}/d/freedomforge-ops/freedomforge-revenue-bot-ops?orgId=1&refresh=15s"
echo "3) Redeploy app and open /dashboard/ops"
echo
echo "If docker permissions fail in current shell, re-login or run: newgrp docker"
