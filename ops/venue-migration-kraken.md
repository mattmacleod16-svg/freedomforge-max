# Venue Migration: Polymarket -> Kraken/Coinbase Spot

This swaps your market execution layer while keeping your existing mission controls, automation cadence, and self-heal framework.

## Why Kraken first

- Mature API + docs for bot automation
- Predictable spot execution model
- Easier operationally than prediction-market event venues

## What changed in repo

- Added venue router: `scripts/venue-engine.js`
- Added Kraken engine: `scripts/kraken-spot-engine.js`
- Added Coinbase engine: `scripts/coinbase-spot-engine.js`
- Added npm scripts:
  - `npm run venue:engine`
  - `npm run kraken:spot`
  - `npm run coinbase:spot`

## Required env for Kraken

```env
TRADE_VENUE=kraken
KRAKEN_ENABLED=true
KRAKEN_DRY_RUN=true
KRAKEN_API_KEY=<your_key>
KRAKEN_API_SECRET=<your_secret>
KRAKEN_PAIR=XXBTZUSD
KRAKEN_ORDER_USD=15
KRAKEN_MIN_CONFIDENCE=0.56
KRAKEN_MIN_INTERVAL_SEC=120
KRAKEN_SIDE_MODE=momentum
```

## Required env for Coinbase (Exchange API)

```env
COINBASE_ENABLED=true
COINBASE_DRY_RUN=true
COINBASE_API_KEY=<your_key>
COINBASE_API_SECRET=<your_base64_secret>
COINBASE_API_PASSPHRASE=<your_passphrase>
COINBASE_PRODUCT_ID=BTC-USD
COINBASE_ORDER_USD=15
COINBASE_MIN_CONFIDENCE=0.56
COINBASE_MIN_INTERVAL_SEC=120
COINBASE_SIDE_MODE=momentum
```

## Optional auto venue mode

```env
TRADE_VENUE=auto
TRADE_VENUE_PRIORITY=kraken,coinbase,polymarket
TRADE_VENUE_AUTO_FALLBACK_ON_SKIP=true
TRADE_VENUE_AUTO_LEARN=true
TRADE_VENUE_MIN_SAMPLES=5
TRADE_VENUE_STATE_FILE=data/venue-performance-state.json
```

`auto` will try enabled venues in priority order and fail over when a venue errors (and optionally when it returns `skipped`).
When `TRADE_VENUE_AUTO_LEARN=true`, it reorders candidates over time using a conservative score based on place-rate, success-rate, skip-rate, and error-rate (after minimum samples).

## Safety-first activation sequence

1) Keep dry-run on:

```bash
KRAKEN_ENABLED=true KRAKEN_DRY_RUN=true TRADE_VENUE=kraken npm run venue:engine
```

2) Verify output has `status: dry-run` and no API errors.

3) Start micro live (Kraken example):

```bash
KRAKEN_ENABLED=true KRAKEN_DRY_RUN=false TRADE_VENUE=kraken KRAKEN_ORDER_USD=10 npm run venue:engine
```

4) Only then raise size/cadence gradually.

5) Coinbase dry-run check:

```bash
COINBASE_ENABLED=true COINBASE_DRY_RUN=true TRADE_VENUE=coinbase npm run venue:engine
```

## Notes

- This is spot momentum execution (not event/prediction contracts).
- Keep compliance and exchange-eligibility checks aligned with your account jurisdiction.
- You can switch back at any time with `TRADE_VENUE=polymarket`.
