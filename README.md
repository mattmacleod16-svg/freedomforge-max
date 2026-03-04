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

Max intelligence + autonomy profile:
	- Set `MAX_INTELLIGENCE_MODE=true` and `AUTONOMY_MAX_MODE=true` to enable high-rigor ensemble behavior.
	- In this mode, routing uses deeper champion/challenger ensembles (up to `CHAMPION_MAX_MODEL_COUNT`, default 5 in max mode).
	- Adaptive reasoning now uses a two-pass committee policy: lean first pass, then escalation only when agreement/confidence is weak or query impact is high.
	- Cost-aware routing knobs for "maximum brainpower within budget":
		- `AI_QUERY_BUDGET_USD` (default `0.012`, max-mode default `0.028`)
		- `AI_CRITICAL_QUERY_BUDGET_USD` (default `0.025`, max-mode default `0.04`) for high-impact/bottom-line decisions
		- `AI_MODEL_COST_PER_1K_TOKENS` (default `0.0022`)
		- `AI_MIN_MODEL_COUNT` / `AI_MAX_MODEL_COUNT` (defaults `1` / `4`, max mode cap `5`)
		- `AI_CRITICAL_MIN_MODEL_COUNT` / `AI_CRITICAL_MAX_MODEL_COUNT` (defaults `3` / `4`) to maintain stronger reasoning floors on critical queries
		- `AI_ESCALATION_AGREEMENT_THRESHOLD` (default `0.23`)
		- `AI_ESCALATION_CONFIDENCE_THRESHOLD` (default `0.56`)
	- Chat metadata now includes `routing_profile` so you can audit mode, bottom-line protection, budget cap, escalation reason(s), and agreement score per query.
	- Adaptive decisioning lowers random exploration, increases evidence weighting, and appends investment-committee style critique constraints.
	- Trading controls become stricter via:
		- `PREDICTION_MIN_EDGE_FOR_ACTION` (recommended `0.24`)
		- `PREDICTION_MIN_RELIABILITY_FOR_ACTION` (recommended `0.64`)
		- `PREDICTION_CALIBRATION_GUARD_BRIER` (recommended `0.21`)
	- If these quality gates fail, autonomy downgrades to monitor mode and suspends new entries until quality recovers.
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
- Option A (direct token): `X_ACCESS_TOKEN` (preferred) or `X_BEARER_TOKEN` with tweet-write permissions
- Option B (OAuth refresh flow): `X_CLIENT_ID`, `X_CLIENT_SECRET` (if required by your X app), and `X_REFRESH_TOKEN`
- Alias names are also accepted: `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`
- Optional override: `X_OAUTH_TOKEN_URL` (defaults to `https://api.x.com/2/oauth2/token`)

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

Optional Clawd bot bridge (extra ensemble firepower):
- Route: `POST /api/clawd` (local Python bridge to `PicoclawClient`)
- Enable in ensemble: `CLAWD_ENABLED=true`
- Provider endpoint (optional override): `CLAWD_ENDPOINT` (defaults to `${APP_BASE_URL}/api/clawd`)
- Optional auth: `CLAWD_API_SECRET` (used by orchestrator as `x-clawd-secret`)
- Production mode (recommended on Vercel): set `CLAWD_HTTP_ENDPOINT` to your hosted Clawd service and optional `CLAWD_HTTP_TOKEN`
- Set `PICOCLAW_CLIENT_SOURCE` to your real `picoclaw_client.py` path if it is outside this repo
- Optional command template for paid bot invocation: `CLAWD_PROMPT_COMMAND_TEMPLATE`, using `{prompt}` placeholder
	- Example: `CLAWD_PROMPT_COMMAND_TEMPLATE=clawd --prompt "{prompt}"`

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
- Daily repository backup workflow `.github/workflows/repo-backup.yml` creates:
	- full git history bundle (`*.bundle`) for complete restore
	- source snapshot archive (`*-src.tar.gz`) for quick recovery
	- checksum manifest (`SHA256SUMS-*.txt`)
	- stored as GitHub Actions artifacts for 90 days
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

SMS morning summary (Twilio):
- Script: `node scripts/send-sms-summary.js`
- Workflow: `.github/workflows/sms-morning-summary.yml` (runs daily at 13:15 UTC + manual trigger)
- Sends wallet balance, last payout transfer, recipient, and X posting guard status to your phone
- Verifies final Twilio delivery status after send and fails on `failed` / `undelivered` / timeout
- Required GitHub secrets:
	- `TWILIO_ACCOUNT_SID`
	- `TWILIO_AUTH_TOKEN`
	- `TWILIO_FROM_NUMBER`
	- `TWILIO_TO_NUMBER`
- Optional GitHub variables:
	- `SMS_MAX_LEN` (default `1200`)
	- `SMS_DELIVERY_TIMEOUT_MS` (default `120000`)
	- `SMS_DELIVERY_POLL_MS` (default `5000`)
Monthly strategy recommendations:
- Script: `npm run monthly-strategy`
- Workflow: `.github/workflows/monthly-strategy.yml` (runs on day 1 of each month at 15:00 UTC + manual trigger)
- Posts actionable optimization recommendations based on failure/skip patterns and payout reliability trends
- Optional vars: `STRATEGY_LOOKBACK_HOURS` (default `720`) and `STRATEGY_LOG_LIMIT` (default `4000`)

Weekly revenue policy review:
- Script: `npm run weekly-policy-review`
- Workflow: `.github/workflows/weekly-policy-review.yml` (runs Mondays at 15:45 UTC + manual trigger)
- Reviews wallet balance, last 7 days of transfer logs, and market context (`/api/status/autonomy`) including geopolitical risk signals
- Auto-selects a compounding policy between 85% and 90% reinvest; in elevated risk-off / geopolitical stress it shifts to stronger preservation (up to 90% reinvest)
- Upserts production Vercel env keys: `SELF_SUSTAIN_REINVEST_BPS`, `TREASURY_MAX_REINVEST_BPS`, `TREASURY_TARGET_ETH`, `MIN_PAYOUT_ETH`
- Attempts production auto-redeploy after applying policy (can be disabled with `POLICY_AUTO_REDEPLOY=false`)
- Required secrets: `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` (optional `VERCEL_TEAM_ID`)
- Optional vars: `POLICY_LOOKBACK_HOURS` (default `168`)

Geopolitical awareness in market intelligence:
- `lib/intelligence/marketFeatureStore.ts` now ingests a global-news geopolitical feed (GDELT) and computes `geopoliticalRisk` plus `geopoliticalSignals`
- These signals are incorporated into market regime classification (`risk_on` / `risk_off` / `neutral`) and flow into autonomy + policy logic
- Optional env vars:
	- `GEOPOLITICAL_FEED_ENABLED` (default `true`)
	- `GEOPOLITICAL_QUERY` (override default global risk query)

Advanced anticipation / prediction stack:
- `lib/intelligence/forecastEngine.ts` now creates a multi-horizon forecast ensemble (default `6h,24h,72h`) and computes a calibration-aware `decisionSignal`
- The decision signal includes weighted probability, weighted confidence, weighted brier, calibration penalty, edge, and shock risk
- `lib/synthesis/orchestrator.ts` now feeds this ensemble-based decision signal into autonomy routing instead of a single-horizon forecast only
- Forecast API exposes this via `GET /api/status/autonomy/forecast` under `decisionSignal`
- Optional env var: `FORECAST_ENSEMBLE_HORIZONS` (default `6,24,72`)

Prediction-market awareness (Polymarket):
- `lib/intelligence/marketFeatureStore.ts` now ingests active Polymarket markets (Gamma API), computes `predictionMarketImpliedRisk`, and extracts `predictionMarketSignals`
- Prediction-market risk is blended into regime classification and forecast `shockRisk`
- Market telemetry now includes `predictionMarketTopContracts` for transparency/debugging
- Optional env vars:
	- `PREDICTION_MARKET_FEED_ENABLED` (default `true`)
	- `PREDICTION_MARKET_ENDPOINT` (default Polymarket Gamma markets endpoint)
	- `PREDICTION_MARKET_LIMIT` (default `80`, bounded `20..150`)

Geopolitical risk spike alerting:
- Script: `npm run geopolitical-watch`
- Workflow: `.github/workflows/geopolitical-watch.yml` (runs every 30 minutes + manual trigger)
- Sends Discord alert when `geopoliticalRisk` crosses threshold
- Optional var: `GEO_RISK_ALERT_THRESHOLD` (default `0.6`)

Continuous background learning:
- Script: `npm run continuous-learning`
- Workflow: `.github/workflows/continuous-learning.yml` (runs every 30 minutes + manual trigger)
- Each cycle performs:
	- Autonomy + market status pull
	- Multi-horizon forecast refresh (`6h,24h,72h` by default)
	- Ensemble policy tuning using live market regime
	- Ground-truth ingestion + retrain check
	- Periodic deep data ingestion (`/api/ingest`) with minimum interval gate
- Optional vars:
	- `CONTINUOUS_FORECAST_HORIZONS` (default `6,24,72`)
	- `CONTINUOUS_POLICY_LIMIT` (default `1800`)
	- `CONTINUOUS_ENABLE_INGEST` (default `true`)
	- `CONTINUOUS_INGEST_MIN_INTERVAL_HOURS` (default `12`)
- Optional secret: `AUTONOMY_ADMIN_KEY`

Daily 24h KPI report:
- Script: `npm run daily-kpi-report`
- Workflow: `.github/workflows/daily-kpi-report.yml` (runs daily at 14:20 UTC + manual trigger)
- Posts a compact report to Discord with:
	- system readiness + active model set
	- wallet balance and 24h payout totals
	- 24h distribution skip reasons (threshold/reserve)
	- market regime + geopolitical risk
	- forecast decision signal (`weightedProbability`, `weightedConfidence`, `edge`, `shockRisk`)
	- forecast calibration metrics (`brier`, `directionalAccuracy`, `calibrationError`)
- Optional vars:
	- `KPI_LOOKBACK_HOURS` (default `24`)
	- `KPI_LOG_LIMIT` (default `2500`)

Automated monthly parameter patch PR:
- Script: `npm run generate-ops-patch`
- Workflow: `.github/workflows/ops-patch-pr.yml` (runs on day 1 of each month at 15:20 UTC + manual trigger)
- Generates:
	- `ops/recommended-env-overrides.env`
	- `ops/strategy-recommendations.md`
- Opens/updates a pull request with suggested env/config tuning based on runtime reliability and payout data
- Optional vars: `PATCH_LOOKBACK_HOURS` (default `720`) and `PATCH_LOG_LIMIT` (default `4000`)
- Optional repo secret: `OPS_PR_TOKEN` (PAT with `repo` scope) to create PRs if default `GITHUB_TOKEN` PR creation is restricted

Automated ensemble policy tuning:
- Endpoint: `POST /api/status/ensemble/policy`
- Workflow: `.github/workflows/ensemble-policy-tuner.yml` (runs hourly at minute 10 UTC + manual trigger)
- Scheduled runs use `regime=neutral` and `limit=1200` (bounded to `100..5000`)
- Manual inputs: `regime` (`neutral`, `risk_on`, `risk_off`, `unknown`) and `limit`

Self-heal watchdog hardening:
- Workflow: `.github/workflows/self-heal.yml` now runs every 5 minutes
- `scripts/self-heal.js` treats payout threshold/reserve skips as expected behavior (not an outage)

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
