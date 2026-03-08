# Polymarket Allowed-Region Live Runbook

Use this when local runs are blocked by Polymarket geoblocking and you need live CLOB execution from a compliant region host.

## What this does

- Provisions Node + repo on remote host
- Uploads scoped `.env.local` values needed for CLOB
- Runs one immediate live cycle (`POLY_CLOB_DRY_RUN=false`)

Script:

- [scripts/polymarket-remote-live.sh](scripts/polymarket-remote-live.sh)

## Prerequisites

Local machine:

- SSH private key for remote host
- Local env file with required keys:
  - `WALLET_PRIVATE_KEY`
  - `ALCHEMY_API_KEY`
  - `POLY_CLOB_API_KEY`
  - `POLY_CLOB_API_SECRET`
  - `POLY_CLOB_API_PASSPHRASE`

Remote host:

- Ubuntu/Debian VM in a region where Polymarket trading is allowed
- SSH access for a user with sudo privileges

## One-command live cycle

```bash
npm run polymarket:remote-live -- \
  --host <REMOTE_HOST_OR_IP> \
  --user <REMOTE_USER> \
  --key <PATH_TO_SSH_PRIVATE_KEY> \
  --repo <GIT_REPO_URL> \
  --remote-dir /opt/freedomforge-max \
  --env-file .env.local \
  --app-base-url https://freedomforge-max.vercel.app \
  --live-once true
```

## Setup only (no immediate trade)

```bash
npm run polymarket:remote-live -- \
  --host <REMOTE_HOST_OR_IP> \
  --user <REMOTE_USER> \
  --key <PATH_TO_SSH_PRIVATE_KEY> \
  --repo <GIT_REPO_URL> \
  --live-once false
```

## Validate remotely

```bash
ssh -i <KEY> <USER>@<HOST>
cd /opt/freedomforge-max
POLY_CLOB_ENABLED=true POLY_CLOB_DRY_RUN=false POLY_CLOB_MIN_INTERVAL_SEC=0 npm run polymarket:clob
```

## Notes

- The script uploads a scoped env subset only (CLOB + chain/runtime keys), not your full local env.
- If remote execution still fails with `403 Trading restricted in your region`, move the VM to a compliant jurisdiction.
