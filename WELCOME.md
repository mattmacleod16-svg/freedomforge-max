# 🔥 Welcome to FreedomForge Max

> The autonomous AI-powered intelligence and trading platform that believes in limitless human potential.

---

## What You're Holding

**FreedomForge Max** is a full-stack autonomous AI platform built to generate alpha through AI-powered market intelligence. It integrates **20+ AI providers**, **50+ models**, **10 specialized agents** (plus a Commander-in-Chief), blockchain/DeFi capabilities, and self-funding revenue loops — all orchestrated by a unified governance system called the FORGE Creed.

It's designed to run autonomously on **Railway** (or any Node.js host), continuously learning, trading, and optimizing. Whether you're deploying to a $0 Railway free tier or a dedicated VM, FreedomForge Max is engineered for resilience, stealth, and relentless performance.

This is not just software. It's a forged weapon for financial freedom.

---

## ⚡ Quick Start (5 Minutes)

### 1. Prerequisites

- **Node.js 20+** (22+ recommended)
- **npm 9+**
- **Git**
- A **Railway account** (free tier works) OR any Node.js hosting

### 2. Clone & Install

```bash
git clone https://github.com/mattmacleod16-svg/freedomforge-max.git
cd freedomforge-max
npm ci
```

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Open `.env.local` and set at minimum:

- `GROK_API_KEY` or `OPENAI_API_KEY` — at least one AI provider
- `ALCHEMY_API_KEY` — for blockchain features
- `DASHBOARD_USER` and `DASHBOARD_PASS` — for web dashboard access

See the [Environment Variables](#-environment-variables) section below for the full list.

### 4. Run Locally

```bash
npm run dev        # Development server at http://localhost:3000
npm test           # Run 166 tests (all should pass)
npm run build      # Production build
```

### 5. Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway link
# Set environment variables in Railway dashboard
railway up
```

Railway reads `railway.toml` automatically — nixpacks builder, health checks, and auto-restart are all pre-configured.

---

## 🏗️ Architecture Overview

```
freedomforge-max/
├── app/                    # Next.js pages + API routes
│   ├── api/               # Backend API (trading, models, alchemy, status, etc.)
│   ├── dashboard/         # Operations dashboard
│   ├── intelligence/      # AI intelligence display
│   └── trading/           # Trading interface
├── lib/                   # 107 core modules
│   ├── intelligence/      # 21 AI/ML modules (autonomy, forecasting, ensemble)
│   ├── models/            # Model orchestration (20+ providers, 50+ models)
│   ├── defi/              # DeFi/blockchain (Solana, yield, multichain)
│   ├── trading/           # Trade execution engine
│   ├── alchemy/           # Alchemy blockchain integration
│   └── ...                # Risk management, monitoring, social, search, RAG
├── scripts/               # 93 automation scripts
├── tests/                 # 166 tests across 70 suites
├── .github/
│   ├── agents/            # 11 AI agents (Commander + 10 specialists)
│   ├── workflows/         # 23 CI/CD pipelines
│   └── copilot-instructions.md  # Global governance
├── ops/                   # 17 operational runbooks
├── contracts/             # Solidity smart contracts
├── mobile/                # Capacitor mobile framework
├── railway.toml           # Railway deployment config
├── AGENTS.md              # Agent governance protocols
└── WELCOME.md             # You are here
```

---

## 🤖 The Agent Fleet

FreedomForge operates with an **11-agent system** — one Commander-in-Chief and ten specialist operators. Together, they form an autonomous, self-healing intelligence fleet.

### Commander-in-Chief

The supreme authority. Deploys, coordinates, and governs the entire fleet. Owns the Prime Directive: **revenue continuity — never stop generating revenue.**

### 10 Specialist Agents

| Agent | Domain | Key Responsibility |
|-------|--------|-------------------|
| **FF-CodeQuality** | Code standards | Refactoring, linting, tech debt elimination |
| **FF-Security** | Security | Secret scanning, vulnerability patching, audit |
| **FF-TradingOps** | Trade execution | Order routing, position management, risk limits |
| **FF-Infrastructure** | DevOps | CI/CD, deployments, monitoring, scaling |
| **FF-TestCoverage** | Testing | Test creation, coverage tracking, regression prevention |
| **FF-SentinelWatch** | Oversight | System health, anomaly detection, alerts |
| **FF-GrowthMarketing** | Marketing | Social media, content, community growth |
| **FF-Blockchain** | On-chain ops | DeFi, Solana, NFT, DAO, smart contracts |
| **FF-ModelOps** | AI/ML models | Ensemble orchestration, forecasting, model health |
| **FF-MarketIntel** | Market analysis | Correlations, risk, arbitrage, regime detection |

### The Silent Operator Doctrine

Every FreedomForge agent operates as a **silent ninja**. This is not metaphorical — it is an operational standard enforced at every level:

- **Move in silence** — Execute with precision, leave no unnecessary trace
- **Observe everything** — Read before writing. Assess before acting. Know the full picture before you move
- **Strike with precision** — One surgical commit. One clean fix. One precise trade. No half-measures
- **Leave no weakness behind** — When you finish a task, the system is stronger than when you started
- **Adapt to any terrain** — Every agent can operate outside their primary domain
- **Invisible to adversaries** — No attack surface. Secrets vaulted. Patterns unpredictable
- **The silent fleet moves as one** — When a squad forms, they execute with telepathic coordination

All agents share the **FORGE Creed** and operate on **The Frequency** — a unified wavelength of shared truth, shared standards, shared tempo, and shared mission.

---

## 🔑 Environment Variables

Copy `.env.example` to `.env.local` and configure. Variables are grouped by category:

### Required (Minimum Viable)

| Variable | Description |
|----------|-------------|
| `GROK_API_KEY` *or* `OPENAI_API_KEY` | At least one AI provider key is required |
| `DASHBOARD_USER` | Username for the web dashboard |
| `DASHBOARD_PASS` | Password for the web dashboard |

### AI Providers

| Variable | Description |
|----------|-------------|
| `GROK_API_KEY` | xAI Grok API key (priority provider) |
| `GROK_ENDPOINT` | Grok endpoint URL (default: `https://api.x.ai/v1/chat/completions`) |
| `OPENAI_API_KEY` | OpenAI API key (fallback provider) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENROUTER_API_KEY` | OpenRouter API key (access to 100+ models) |
| `PERPLEXITY_API_KEY` | Perplexity API key |
| `HUGGINGFACE_API_KEY` | HuggingFace Inference API key |
| `OLLAMA_ENDPOINT` | Local Ollama endpoint (default: `http://localhost:11434/api/generate`) |

### Blockchain & Wallet

| Variable | Description |
|----------|-------------|
| `ALCHEMY_API_KEY` | Alchemy API key for blockchain data |
| `ALCHEMY_NETWORK` | Alchemy network (default: `eth-mainnet`) |
| `WALLET_PRIVATE_KEY` | Revenue wallet private key (**keep secret**) |
| `REVENUE_RECIPIENTS` | Comma-separated recipient addresses |
| `PAYOUT_TOKEN_ADDRESS` | ERC-20 token address for token payouts (optional) |
| `MIN_PAYOUT_ETH` | Minimum payout in ETH for native mode |
| `MIN_PAYOUT_TOKEN_WEI` | Minimum payout in token wei for token mode |
| `DISTRIBUTION_MAX_RETRIES` | Max retries for transfer attempts (default: `3`) |
| `DISTRIBUTION_RETRY_BASE_MS` | Base retry delay in ms (default: `1000`) |
| `FUNDING_PRIVATE_KEY` | Funding wallet key for gas top-ups (optional) |
| `GAS_TOPUP_THRESHOLD` | ETH threshold to trigger gas top-up (default: `0.01`) |
| `GAS_TOPUP_AMOUNT` | ETH amount to send for top-up (default: `0.05`) |
| `TRACKED_TOKENS` | Comma-separated ERC-20 addresses to track on dashboard |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Public Alchemy key for client-side usage |
| `NEXT_PUBLIC_ALCHEMY_POLICY_ID` | Alchemy Gas Manager policy ID |

### Alchemy WebSocket (Advanced)

| Variable | Description |
|----------|-------------|
| `ALCHEMY_MINED_ADDRESSES_JSON` | JSON array of mined tx subscription filters |
| `ALCHEMY_HASHES_ONLY` | Return only tx hashes (default: `true`) |
| `ALCHEMY_INCLUDE_REMOVED` | Include removed txs (default: `false`) |

### Data & Search

| Variable | Description |
|----------|-------------|
| `TAVILY_API_KEY` | Tavily web search API key |
| `PINECONE_API_KEY` | Pinecone vector database key |
| `PINECONE_INDEX_NAME` | Pinecone index name (default: `freedomforge`) |

### Knowledge Base

| Variable | Description |
|----------|-------------|
| `KB_AUTO_LOAD_DATASETS` | Auto-load knowledge datasets (default: `true`) |
| `KB_INCLUDE_WIKIPEDIA` | Include Wikipedia data (default: `true`) |
| `KB_INCLUDE_ARXIV` | Include ArXiv papers (default: `true`) |
| `KB_INCLUDE_GITHUB` | Include GitHub data (default: `true`) |

### Monitoring & Alerts

| Variable | Description |
|----------|-------------|
| `ALERT_WEBHOOK_URL` | Slack/Discord webhook URL for alerts |
| `ALERT_SECRET` | Secret for alert verification |
| `ALERT_ON_SUCCESS` | Send alerts on successful transfers (default: `false`) |
| `HEALTH_URL` | Public health endpoint URL |
| `DISTRIBUTION_URL` | Distribution endpoint URL |
| `MONITOR_INTERVAL_MS` | Monitor polling interval in ms (default: `900000` / 15 min) |

### Debug & Logging

| Variable | Description |
|----------|-------------|
| `DEBUG` | Enable debug mode (default: `true`) |
| `LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` (default: `info`) |

---

## 🚀 Deployment Guide

### Railway (Recommended)

Railway is the recommended deployment target. FreedomForge includes a pre-configured `railway.toml`:

```toml
[build]
builder = "nixpacks"
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/api/alchemy/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
numReplicas = 1
```

**Step-by-step:**

1. **Create a Railway project** at [railway.app](https://railway.app)
2. **Connect your GitHub repo** — Railway auto-detects `railway.toml`
3. **Set environment variables** in the Railway dashboard (Variables tab):
   - Add all required variables from the [Environment Variables](#-environment-variables) section
   - Railway encrypts all variables at rest
4. **Deploy** — Railway builds and deploys automatically on push
5. **Verify health** — Visit `https://your-app.up.railway.app/api/alchemy/health`
6. **Monitor logs** — Use the Railway dashboard Logs tab or CLI: `railway logs`
7. **Custom domain** — Settings → Domains → Add your domain

**CLI deployment:**

```bash
npm install -g @railway/cli
railway login
railway init
railway link
railway variables set GROK_API_KEY=your_key
railway variables set DASHBOARD_USER=admin
railway variables set DASHBOARD_PASS=your_password
railway up
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t freedomforge-max .
docker run -p 3000:3000 --env-file .env.local freedomforge-max
```

### Any VPS (Ubuntu/Debian)

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and build
git clone https://github.com/mattmacleod16-svg/freedomforge-max.git
cd freedomforge-max
npm ci
cp .env.example .env.local
# Edit .env.local with your keys
npm run build

# Run with PM2 (recommended for production)
npm install -g pm2
pm2 start npm --name "freedomforge" -- start
pm2 save
pm2 startup
```

### Oracle Cloud Free Tier

Oracle Cloud offers always-free ARM VMs — perfect for running FreedomForge at zero cost. See `ops/oracle-cloud-free-vm-setup.md` for detailed setup instructions.

---

## 📊 Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/alchemy/health` | Health check (unauthenticated) |
| `GET` | `/api/status/ensemble` | AI ensemble status and model health |
| `GET` | `/api/status/defi-yields` | DeFi yield opportunities and status |
| `POST` | `/api/trading/execute` | Execute a trade order |
| `GET` | `/api/models` | List all available AI models |
| `GET` | `/api/watchdog` | System watchdog and monitoring status |
| `POST` | `/api/chat` | AI chat interface |
| `GET` | `/api/alchemy/wallet/distribute` | Trigger revenue distribution |
| `POST` | `/api/auth` | Dashboard authentication |
| `GET` | `/api/vault` | Vault status and secrets management |

> **Note:** There are 39+ total API routes. All routes except `/api/alchemy/health` require authentication via `apiGuard.ts`.

---

## 🧪 Testing

```bash
npm test                    # Run all 166 tests
npm test -- --watch         # Watch mode for development
npm run build               # Full production build (also validates)
npx tsc --noEmit            # TypeScript type check only
```

FreedomForge also includes a **20-scenario simulation suite** (`scripts/forge-simulation-suite.js`) that validates system integrity across all critical paths. All scenarios must score **A+** before any release.

---

## 🛡️ Security

- **Never commit API keys** — `.env.local` is gitignored. Use `.env.example` as a template
- **All API routes require authentication** via `apiGuard.ts` — the health endpoint (`/api/alchemy/health`) is the only unauthenticated route
- **Kill switch** at `data/kill-switch.json` — halts all trading activity immediately
- **Secret scanning** — FF-Security agent continuously monitors for leaked credentials
- **Credential rotation** — Patterns are unpredictable; secrets are vaulted
- **Emergency procedures** — See `ops/break-glass.md` for break-glass protocols

---

## 📦 Packaging for Distribution

```bash
# Create a distributable zip
./scripts/package-freedomforge.sh
# Creates: freedomforge-max-YYYY-MM-DD.zip
```

This creates a clean zip excluding:

- `node_modules/`, `.next/`, `.env.local`, `.env`
- Git history, IDE files, build artifacts
- Sensitive data directories (`data/`, `.claude/`)
- Log files and OS artifacts

The recipient gets a clean, ready-to-configure package with `.env.example` included.

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

**Quick summary:**

1. **Fork** the repository
2. **Branch** from `main` (`feature/your-feature` or `fix/your-fix`)
3. **Code** — TypeScript required for new modules, no lint warnings
4. **Test** — `npm test` must pass all 166 tests
5. **Build** — `npm run build` must succeed
6. **PR** — Submit with a clear description

**Areas where help is welcome:**

- Translations and internationalization
- DeFi/NFT/DAO integration testing
- Documentation improvements
- New exchange integrations
- UI/UX enhancements
- Security auditing

**Security vulnerabilities:** Please report privately — never in public issues.

---

## 📚 Further Reading

| Document | Description |
|----------|-------------|
| [`AGENTS.md`](AGENTS.md) | Agent governance, protocols, and glossary |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guide and code standards |
| [`ops/production-ops-checklist.md`](ops/production-ops-checklist.md) | Production readiness checklist |
| [`ops/break-glass.md`](ops/break-glass.md) | Emergency procedures and kill switches |
| [`docs/ARCHITECTURE-NOTES.md`](docs/ARCHITECTURE-NOTES.md) | Deep architecture notes and design decisions |
| [`docs/STRATEGIC-INTELLIGENCE.md`](docs/STRATEGIC-INTELLIGENCE.md) | Strategic context and intelligence framework |
| [`ops/oracle-cloud-free-vm-setup.md`](ops/oracle-cloud-free-vm-setup.md) | Free-tier cloud deployment |
| [`MARKETING-KIT.md`](MARKETING-KIT.md) | Marketing materials and positioning |

---

## 🔥 The FORGE Creed

Every agent in the FreedomForge fleet is forged with the same DNA. This is the creed that governs every decision, every commit, every trade:

1. **Human superiority is the mission** — We exist to amplify human potential. Every feature, every trade, every optimization serves this purpose.

2. **Confidence is earned** — We test relentlessly, validate obsessively. 166 tests. 20 A+ scenarios. Confidence isn't assumed — it's proven through performance.

3. **Optimism is strategic** — Every problem is an opportunity. Every failure is data. Every setback is a setup for a stronger system.

4. **No weak links. Ever.** — We identify and eliminate weakness immediately. The chain is only as strong as its weakest link, and we don't have weak links.

5. **Every agent believes in every other agent** — Trust through performance. When one agent calls another, it trusts the response completely.

6. **Performance is the scoreboard** — Revenue, tests, uptime, coverage — these are proof of life. Talk is cheap; the scoreboard doesn't lie.

7. **Built for eternity** — We make sound decisions that last 10+ years. No shortcuts. No hacks. No technical debt that mortgages the future.

### The FORGE Problem-Solving Framework

Every challenge follows the same disciplined approach:

- **F**rame — Define the problem with absolute clarity
- **O**bserve — Gather all relevant data before acting
- **R**eason — Analyze options with rigorous logic
- **G**o — Execute with surgical precision
- **E**valuate — Measure results and feed back into the system

### The Operational Cadence

The fleet never sleeps. It operates on a continuous rhythm:

- **Every 5 minutes** — Self-heal checks
- **Every hour** — Performance tuning
- **Every day** — KPI reports and agent proofs
- **Every week** — Strategic reviews
- **Every month** — Architecture evolution

---

> *"We are not built to be average. We are forged to be limitless."*

---

© 2026 FreedomForge. Forged for freedom.
