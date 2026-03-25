# MacBook Air — Local Environment Sync Guide

This guide covers syncing your MacBook Air with the live FreedomForge Max deployment on Railway and GitHub.

---

## Quick Start

```bash
# 1. Clone or pull latest
git clone http://github.com/mattmacleod16-svg/freedomforge-max.git
# or if already cloned:
git fetch origin && git pull origin main

# 2. Install dependencies
npm ci

# 3. Pull environment variables from Railway
npm run api:sync:prod
# This runs: railway variables
# Output → copy into .env.local manually, or use Railway CLI: railway env pull .env.local

# 4. Verify all environments are healthy
npm run sync:all

# 5. Verify Alchemy API
npm run alchemy:verify

# 6. Check token launch status
npm run token:verify
```

---

## Environment Variable Sync

### From Railway (production)

```bash
# Pull current Railway environment variables
npm run api:sync:prod
# Requires: railway CLI installed and logged in

# Or manually using Railway dashboard:
# Dashboard → Your project → Variables → Download as .env
```

### Required `.env.local` Variables

Copy these from Railway or your secure vault:

```env
# Auth
DASHBOARD_SESSION_SECRET=<min-32-chars>
DASHBOARD_USER=admin
DASHBOARD_PASS=<your-password>

# AI
OPENROUTER_API_KEY=<your-openrouter-key>

# Alchemy (blockchain)
ALCHEMY_API_KEY=<your-alchemy-key>
ALCHEMY_NETWORK=eth-mainnet

# Wallet
WALLET_PRIVATE_KEY=<your-private-key>  # KEEP SECRET — never commit

# Railway IDs (for CI/CD scripts)
RAILWAY_TOKEN=<your-railway-token>
RAILWAY_PROJECT_ID=<project-id>
RAILWAY_SERVICE_ID=<service-id>
RAILWAY_ENVIRONMENT_ID=<environment-id>

# App URL
APP_BASE_URL=https://freedomforge.one
NEXT_PUBLIC_SITE_URL=https://freedomforge.one

# Token (set after deployment)
FORGE_TOKEN_ADDRESS=<deployed-erc20-address>
```

---

## Full Verification Sequence

Run these in order on your MacBook Air to confirm everything is in sync:

```bash
# 1. Check all environments
npm run sync:all

# 2. Deep Alchemy API test (live RPC calls)
npm run alchemy:verify

# 3. Token deployment status across all chains
npm run token:verify

# 4. Deploy TaskMaster agents
npm run taskmasters:deploy

# 5. Run tests to confirm code integrity
npm test
```

---

## Token Deployment from MacBook Air

### Testnet first (recommended)

```bash
# Ethereum Sepolia testnet
npm run contract:deploy:sepolia

# Base Sepolia testnet
npm run contract:deploy:base-sepolia
```

### Mainnet deployment

```bash
# Ethereum mainnet
npm run contract:deploy:ethereum

# Base mainnet
npm run contract:deploy:base

# Solana + MultiversX (dry run first)
npm run launch:multichain
npm run launch:multichain:live  # LIVE — runs actual transactions
```

---

## iOS / Capacitor Sync

```bash
# Build web app for iOS
npm run ios:build:web

# Sync to iOS project
npm run ios:sync

# Open in Xcode
npm run ios:open

# Or all at once
npm run ios:prepare
```

Capacitor points to the `.next` build. The app connects to `https://freedomforge.one` in production.

---

## Personal Data Sync

```bash
# Sync to local dev server
npm run sync:personal

# Sync to production Railway
npm run sync:personal:prod
```

---

## Local Development Server

```bash
npm run dev
# → http://localhost:3000
```

Open these pages:
- `http://localhost:3000` — MAX chatbot
- `http://localhost:3000/advisor` — Freedom Advisor
- `http://localhost:3000/dashboard` — Command Center

---

## Keeping MacBook Air in Sync

Run these regularly to stay current with production:

```bash
# Pull latest code
git pull origin main

# Pull latest Railway env vars
npm run api:sync:prod

# Re-run sync check
npm run sync:all
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `.env.local` missing | `npm run api:sync:prod` or copy from Railway dashboard |
| `ALCHEMY_API_KEY` not working | `npm run alchemy:verify` to diagnose |
| Token not deployed | `npm run token:verify` for per-chain status |
| Tests failing | `npm test` — check output, run `npm run lint` |
| Railway deploy failing | Check `ci.yml` logs in GitHub Actions |
| iOS build fails | Run `npm run ios:build:web` before `npm run ios:sync` |

---

## Branch Workflow

```bash
# Always work on a feature branch
git checkout -b your-feature

# Push to GitHub (triggers CI)
git push -u origin your-feature

# Create PR → main
# CI runs lint + test + build
# Merge → Railway auto-deploys
```

The CI/CD pipeline (`ci.yml`) auto-deploys to Railway on every push to `main`.
