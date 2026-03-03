This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Custom AI Sidekick Features

> **Reliability note** – the superagent must never stop generating revenue.  the
> code now includes extensive alerting if anything goes wrong (distribution
> failures, missing config, bad health) and you can run a local monitor as a
> second safety net.


- Multi-model orchestration (Grok, OpenAI, Anthropic, local)
- Real-time web search and RAG knowledge base
- Data ingestion from Wikipedia, ArXiv, GitHub, etc.
- Alchemy blockchain integration (Opera support) with a dedicated revenue wallet
- Optional ERC‑20 token tracking: set `TRACKED_TOKENS` (comma-separated contract addresses) and the dashboard will show balances
- Set `WALLET_PRIVATE_KEY` to keep one stable production revenue wallet address across deploys.
- `WALLET_AUTO_GENERATE=true` is for local testing only (ephemeral wallet); keep it unset/false in production.
- Revenue wallet can automatically distribute funds to a configurable list of addresses (`REVENUE_RECIPIENTS`). Use a single recipient value if you want one destination wallet.
- Optional gas self-funding: set `FUNDING_PRIVATE_KEY` so the bot auto-topups gas when revenue wallet balance drops below `GAS_TOPUP_THRESHOLD`.
- Optional token payouts: set `PAYOUT_TOKEN_ADDRESS` to distribute an ERC-20 token balance instead of native ETH (for Base bridged WETH use `0x4200000000000000000000000000000000000006` and set `ALCHEMY_NETWORK=base-mainnet`)
- Distribution tuning:
	- `MIN_PAYOUT_ETH` minimum per-recipient native ETH payout (default `0`)
	- `MIN_PAYOUT_TOKEN_WEI` minimum per-recipient token payout in raw wei (default `0`)
	- `DISTRIBUTION_MAX_RETRIES` and `DISTRIBUTION_RETRY_BASE_MS` for retry/backoff behavior
	- `ALERT_ON_SUCCESS=true` to send webhook notifications for successful payouts
- Self-sustaining payout mode (no constant manual topups):
	- `GAS_RESERVE_ETH` native ETH kept in the revenue wallet before payouts (default `0.02`)
	- `SELF_SUSTAIN_REINVEST_BPS` basis points of post-reserve funds retained for growth (default `2000` = 20%)
	- `FUNDING_PRIVATE_KEY` optional treasury key for automatic gas topups when below threshold
- Horizontal scaling:
	- Distribution endpoint accepts shard params: `/api/alchemy/wallet/distribute?shard=0&shards=2&botId=bot-0`
	- Workflow `.github/workflows/distribute-horizontal.yml` runs up to 4 shard bots in parallel
	- Configure `BOT_SHARDS` repo variable (or manual workflow input) for active shard count
- Optional future AA sponsorship config: `ALCHEMY_GAS_POLICY_ID` (reserved for smart-account migration path)
- Optional alerting: set `ALERT_WEBHOOK_URL` (and optionally `ALERT_SECRET`) to receive notifications if distributions fail or the wallet misbehaves
- Optional Discord ping: set `ALERT_MENTION` to `<@USER_ID>` or `<@&ROLE_ID>` to prepend mentions on Discord webhook alerts
- `HEALTH_URL` (used in cron workflows) should point to `<your‑app>/api/alchemy/health` so uptime jobs can detect downtime
- Dashboard access uses an in-app login page at `/login`; set `DASHBOARD_USER`, `DASHBOARD_PASS`, and `DASHBOARD_SESSION_SECRET` in your environment for secure session-based access to `/dashboard`.
- Optional protocol integrations:
	- `ZORA_RPC_URL` enables Zora protocol health checks (`/api/status/protocols`)
	- `VVV_AI_HEALTH_URL` enables VVV AI protocol health checks (optional `VVV_AI_API_KEY` bearer auth)
	- Agent protocol stack (all visible in `/api/status/protocols`):
		- `MCP_ENABLED=true` + optional `MCP_HEALTH_URL` (Model Context Protocol)
		- `ACP_ENABLED=true` + optional `ACP_HEALTH_URL` (Agent Communication Protocol)
		- `A2A_ENABLED=true` + optional `A2A_HEALTH_URL` (Agent-to-Agent Protocol)
		- `AUI_ENABLED=true` + optional `AUI_HEALTH_URL` (Agent-User Interaction Protocol)
- Emotion-aware ElevenLabs TTS API: `POST /api/chat/tts`
	- Required: `ELEVENLABS_API_KEY`
	- Optional: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`
	- Supports `emotion` values: `neutral`, `positive`, `concerned`, `urgent`

Text-first interaction policy:
- The app prioritizes typed exchanges for reliability/auditability.
- Voice playback is optional and manual via ElevenLabs endpoint.

Vendor capability stack (benefit capture + optional health checks):
- Uses strategy primitives inspired by Acorns, SignalStack, Tickeron, TrendSpider, BlackBox Stocks, Forex Fury, Capitalise.ai, EquBot, Kensho, Acuity, 3Commas, OptionsAI, and Kavout.
- Endpoint: `/api/status/vendor-stack`
- Optional per-vendor env flags (default disabled):
	- `<VENDOR>_ENABLED=true` and optional `<VENDOR>_HEALTH_URL`
	- Vendor keys: `ACORNS`, `SIGNALSTACK`, `TICKERON`, `TRENDSPIDER`, `BLACKBOXSTOCKS`, `FOREXFURY`, `CAPITALISEAI`, `EQUBOT`, `KENSHO`, `ACUITY`, `THREECOMMAS`, `OPTIONSAI`, `KAVOUT`

X audience growth automation (for `@Mac_man17`):
- Status endpoint: `/api/status/x`
- Trigger endpoint: `POST /api/x/automation`
- Script: `npm run x-growth`
- Workflow: `.github/workflows/x-growth.yml` (every 6 hours, default dry-run)
- Set GitHub repo variable `X_SCHEDULED_LIVE=true` to make scheduled runs post live (`false`/unset keeps schedule in dry-run)

Required environment for posting:
- `X_HANDLE=@Mac_man17`
- `X_ACCESS_TOKEN` (preferred) or `X_BEARER_TOKEN` with tweet-write permissions

Recommended safety controls:
- `X_DRY_RUN=true` (default) until validated
- `X_POST_COOLDOWN_MINUTES=120`
- `X_POST_DAILY_LIMIT=3`
- `X_AUTOMATION_SECRET=<strong-random-secret>` for endpoint/workflow authorization

Profile automation setup notes:
- In X account settings for `@Mac_man17`, use your automation/app connection options and authorize the app credentials used above.
- After credentials are set, run one manual dry-run (`npm run x-growth`) and then one live run (`X_DRY_RUN=false npm run x-growth`) to verify posting.
- Keep posting policy text-first and informative to avoid spam-like behavior and maximize sustainable reach.
- Health check endpoint `/api/alchemy/health` returns `{status:'ok'}` for uptime monitors
- Extensible via APIs under `/api/*` (including `/api/alchemy/wallet` for managing funds and `/api/alchemy/wallet/distribute` to trigger payout)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

### Monitoring / fail‑safe

If you want additional assurance beyond the GitHub Actions cron, run the
included monitor script on any continuously running machine (a VPS, home
server, etc.):

```bash
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/… \
ALERT_MENTION=<@&ROLE_ID> \
DISTRIBUTION_URL=https://yourapp.vercel.app/api/alchemy/wallet/distribute \
HEALTH_URL=https://yourapp.vercel.app/api/alchemy/health \
node scripts/monitor.js
```

You can also add it to `package.json` via `npm run monitor` (variable support
is the same).  It will alert you via the webhook whenever the distribution call
fails for any reason.

### Discord ping test endpoint

Use this endpoint to send a real test message through the same alert pipeline:

```bash
curl -sS "https://yourapp.vercel.app/api/status/ping-discord?source=manual&note=smoke-test&secret=$ALERT_SECRET"
```

Requirements:
- `ALERT_WEBHOOK_URL` must be set
- `ALERT_SECRET` must be set (used for authorization)
- Auth accepted via `?secret=...`, `x-alert-secret` header, or `Authorization: Bearer ...`

One-click GitHub test:
- Run workflow `.github/workflows/ping-discord.yml` from the Actions tab
- Set repo secret `ALERT_SECRET`
- Keep default `endpoint_url` (or override for another environment)

Auto ping after successful deploys:
- Workflow: `.github/workflows/ping-discord-on-deploy.yml`
- Trigger: `deployment_status` with `state=success`
- Required repo secret: `ALERT_SECRET`
- Optional repo variable: `ALERT_PING_ENDPOINT_URL` (defaults to production ping endpoint)

Continuous upkeep automation:
- CI workflow `.github/workflows/ci.yml` runs lint + build on PRs and `main`
- Dependabot `.github/dependabot.yml` opens weekly update PRs for npm + GitHub Actions
- Dependabot groups patch/minor npm updates to reduce PR noise
- Auto-merge workflow `.github/workflows/dependabot-automerge.yml` approves and enables merge for safe Dependabot patch/minor updates after checks pass
- Revenue distribution workflows:
	- `.github/workflows/distribute.yml` single-bot scheduler
	- `.github/workflows/distribute-horizontal.yml` parallel shard bots for horizontal scaling

Weekly profitability reporting:

Daily health snapshot:
- Workflow: `.github/workflows/daily-health-snapshot.yml` (runs daily at 14:30 UTC + manual trigger)
- Posts one consolidated Discord update with:
	- `/api/status` readiness and HTTP status
	- `/api/alchemy/health` result
	- latest run outcomes for `ping-discord`, `self-heal`, `weekly-summary`, `monthly-strategy`, and `ops-patch-pr`
Monthly strategy recommendations:
- Script: `npm run monthly-strategy`
- Workflow: `.github/workflows/monthly-strategy.yml` (runs on day 1 of each month at 15:00 UTC + manual trigger)
- Posts actionable optimization recommendations based on failure/skip patterns and payout reliability trends
- Optional vars: `STRATEGY_LOOKBACK_HOURS` (default `720`) and `STRATEGY_LOG_LIMIT` (default `4000`)

Automated monthly parameter patch PR:
- Script: `npm run generate-ops-patch`
- Workflow: `.github/workflows/ops-patch-pr.yml` (runs on day 1 of each month at 15:20 UTC + manual trigger)
- Generates:
	- `ops/recommended-env-overrides.env`
	- `ops/strategy-recommendations.md`
- Opens/updates a pull request with suggested env/config tuning based on runtime reliability and payout data
- Optional vars: `PATCH_LOOKBACK_HOURS` (default `720`) and `PATCH_LOG_LIMIT` (default `4000`)
- Optional repo secret: `OPS_PR_TOKEN` (PAT with `repo` scope) to create PRs if default `GITHUB_TOKEN` PR creation is restricted

One-click apply to Vercel envs:
- Script: `npm run apply-vercel-env`
- Workflow: `.github/workflows/apply-vercel-env.yml`
- Inputs:
	- `target`: `production`, `preview`, `development`, or `all`
	- `apply_keys`: optional comma-separated subset (blank = apply all recommended keys)
	- `dry_run`: `true` to preview, `false` to write changes
- Required GitHub secrets for write mode:
	- `VERCEL_TOKEN`
	- `VERCEL_PROJECT_ID`
	- Optional `VERCEL_TEAM_ID` (for team-owned projects)

Chained post-merge preview notification:
- Workflow: `.github/workflows/ops-patch-preview-notify.yml`
- Trigger: when PR `automation/monthly-ops-patch` is merged (or manual run)
- Runs `npm run apply-vercel-env` in `DRY_RUN=true` mode against production target
- Posts success/failure + dry-run preview output to Discord using `ALERT_WEBHOOK_URL`
- Optional guarded auto-apply after successful preview:
	- Set repo variable `AUTO_APPLY_ENABLED=true`
	- Set repo variable `AUTO_APPLY_APPROVED_KEYS` to comma-separated allowlisted keys (example: `ALERT_ON_SUCCESS,DISTRIBUTION_MAX_RETRIES`)
	- Set repo variable `AUTO_APPLY_REQUIRED_LABEL=autopatch-approved` (default) and add that label to the merged ops patch PR
	- Workflow dispatches `.github/workflows/apply-vercel-env.yml` with `dry_run=false` only for matched allowlisted keys
	- Max-change policy vars (defaults):
		- `AUTO_APPLY_MAX_DISTRIBUTION_MAX_RETRIES=6`
		- `AUTO_APPLY_MAX_DISTRIBUTION_RETRY_BASE_MS=5000`
		- `AUTO_APPLY_MAX_GAS_TOPUP_THRESHOLD=0.1`
		- `AUTO_APPLY_MAX_GAS_TOPUP_AMOUNT=0.2`

Remote dashboard access:
- Main app: `https://freedomforge-max.vercel.app`
- Dashboard: `https://freedomforge-max.vercel.app/dashboard`
- Logs view: `https://freedomforge-max.vercel.app/api/alchemy/wallet/logs?limit=50`
- Dashboard is protected with session authentication via `DASHBOARD_USER` and `DASHBOARD_PASS` (signed with `DASHBOARD_SESSION_SECRET`)
- Set strong production credentials in Vercel project environment variables to access it securely from anywhere

Revenue automation hardening:
- Workflow `.github/workflows/distribute.yml` now supports manual trigger + scheduled runs
- Adds retries/timeouts for health/distribution calls and validates distribution response payload
- Uses workflow concurrency guard to prevent overlapping payout jobs

Autonomous self-healing bot:
- Workflow: `.github/workflows/self-heal.yml` (runs every 10 minutes + manual trigger)
- Script: `npm run self-heal`
- Detects errors using `/api/alchemy/health` and `/api/status`
- Sends Discord alert when issue is detected
- Attempts multi-step remediation: `POST /api/status`, wallet warmup, and distribution kick
- Runs a second remediation pass automatically if first pass does not clear the issue
- Re-checks service and sends a second Discord alert when issue is cleared (or unresolved)

Required for self-heal workflow:
- Repo secret `ALERT_WEBHOOK_URL`
- Optional repo secret `ALERT_MENTION`
- Optional repo variable `APP_BASE_URL` (defaults to production URL)

### Persistent logging

The app now keeps a local JSONL log at `data/events.log` with events for
gas top-ups, distribution attempts, transfers, and failures. This file is
ignored by Git. Use the API endpoint `/api/alchemy/wallet/logs?limit=200` to
fetch the most recent entries.


## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
