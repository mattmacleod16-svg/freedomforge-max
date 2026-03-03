# Oracle Cloud Free VM Setup (Prometheus + Grafana + In-App Embed)

This guide runs your monitoring stack on Oracle Cloud free tier and embeds Grafana into `/dashboard/ops`.

## 1) Create VM (Oracle Always Free)

- Shape: `VM.Standard.E2.1.Micro` (or ARM free shape)
- OS: Ubuntu 22.04+
- Allow inbound ports in Oracle security list / NSG:
  - `22` (SSH)
  - `80` (HTTP, for TLS challenge + redirect)
  - `443` (HTTPS Grafana via Caddy)
  - `9090` (Prometheus, optional; can keep private)

## 1.5) DNS (required for automatic HTTPS)

- Create an `A` record from your domain/subdomain to your Oracle VM public IP.
- Example: `metrics.yourdomain.com -> <ORACLE_VM_PUBLIC_IP>`

## 2) Install Docker + Compose

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in after the `usermod` step.

### Fast path (one command bootstrap)

From the repo root on the Oracle VM:

```bash
bash scripts/oracle-bootstrap.sh \
  --domain metrics.yourdomain.com \
  --email you@example.com \
  --grafana-user admin \
  --grafana-pass 'StrongPass123!'
```

Optional arguments:
- `--repo https://github.com/<owner>/<repo>.git` (if repo not cloned yet)
- `--dir /opt/freedomforge-max` (install location)
- `--auth-hash '$2a$...'` (optional Caddy basic auth bcrypt hash)

## 3) Copy Repo + Start Monitoring Stack

```bash
git clone <your-repo-url>
cd freedomforge-max/monitoring
cp .env.example .env
# Edit .env and set:
# - GRAFANA_ADMIN_USER / GRAFANA_ADMIN_PASSWORD
# - CADDY_DOMAIN (your DNS name)
# - CADDY_EMAIL
docker compose up -d
docker compose ps
```

Grafana (HTTPS): `https://<YOUR_CADDY_DOMAIN>`

Optional Caddy basic auth:

```bash
docker compose run --rm caddy caddy hash-password --plaintext 'your-strong-password'
```

Copy the hash into `CADDY_BASICAUTH_HASH` in `.env`, then restart:

```bash
docker compose up -d
```

## 4) Verify Prometheus Target

Open Prometheus UI: `http://<ORACLE_VM_PUBLIC_IP>:9090/targets`

The `freedomforge-bot` target should be `UP`.

## 5) Configure Embed URL in App (Vercel)

Set production env var in Vercel:

```bash
NEXT_PUBLIC_GRAFANA_EMBED_URL=https://<YOUR_CADDY_DOMAIN>/d/freedomforge-ops/freedomforge-revenue-bot-ops?orgId=1&refresh=15s
```

Then redeploy app. Visit:

- `https://freedomforge-max.vercel.app/dashboard/ops`

## 6) Hardening (Recommended)

- Caddy HTTPS is included in this stack by default.
- Restrict `9090` to your IP only (or keep closed publicly).
- Replace default Grafana admin credentials.
- If using anonymous Grafana access, keep Viewer-only and no admin rights.
- Keep Oracle NSG/security-list scoped to required ports only.

## 7) Useful Commands

```bash
cd freedomforge-max/monitoring
docker compose logs -f
docker compose restart
docker compose down
```
