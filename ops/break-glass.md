# Break-Glass Runbook

Use this when the bot appears stalled, failing, or not sending payouts.

## 0) Fast Triage (60 seconds)

```bash
cd /Users/mattyice/Desktop/freedomforge-max
npm run daily-check
```

If `PASS`, no action needed.

---

## 1) Service/API sanity

```bash
curl -sS https://<YOUR_APP_URL>/api/alchemy/health
curl -sS https://<YOUR_APP_URL>/api/status
curl -sS https://<YOUR_APP_URL>/api/alchemy/wallet
curl -sS "https://<YOUR_APP_URL>/api/alchemy/wallet/logs?limit=80"
```

Expected:
- health returns `{ "status": "ok" }`
- wallet has address + balance field

---

## 2) Force one manual distribution run

```bash
curl -sS "https://<YOUR_APP_URL>/api/alchemy/wallet/distribute?shard=0&shards=1&botId=break-glass-$(date +%s)"
```

If HTTP is not 200, check latest alert:

```bash
curl -sS https://<YOUR_APP_URL>/api/alchemy/wallet/alerts
```

---

## 3) Common failure patterns + fixes

### A) Top-up/funding errors
Symptoms:
- `gas_topup_error`
- `distribution_skipped_no_gas`

Fix:
- Refill funding wallet and rerun manual distribution.
- Confirm `FUNDING_PRIVATE_KEY` exists in Railway (or Vercel) Production env.

### B) Repeated `results: null`
Symptoms:
- distribution returns 200 but `results` is null often

Fix:
- Lower `MIN_PAYOUT_ETH` or reduce `GAS_RESERVE_ETH`, or fund revenue wallet more.
- Run smoke test after adjustment.

### C) API unhealthy / status not ready
Fix:

```bash
curl -sS -X POST https://<YOUR_APP_URL>/api/status
```

Wait 10–20 seconds and recheck `/api/status` and `/api/alchemy/health`.

---

## 4) Verify schedulers are still running

In GitHub Actions, confirm recent successful runs for:
- `distribute.yml`
- `self-heal.yml`

CLI (optional):

```bash
gh run list --workflow distribute.yml --limit 5
gh run list --workflow self-heal.yml --limit 5
```

If disabled/failing, manually trigger workflow dispatch from Actions UI.

---

## 5) Re-deploy only if config/runtime is stuck

```bash
cd /Users/mattyice/Desktop/freedomforge-max
railway up --detach   # or: vercel --prod --yes
npm run smoke:prod
```

---

## 6) Post-incident closeout

- Confirm `npm run daily-check` returns `PASS`.
- Save incident note (what failed, root cause, fix).
- If recurring, tighten thresholds/alerts before going hands-off again.
