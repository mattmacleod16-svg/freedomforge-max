declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
    DASHBOARD_USER?: string;
    DASHBOARD_PASS?: string;
    DASHBOARD_SESSION_SECRET?: string;
    ALCHEMY_API_KEY?: string;
    ZORA_RPC_URL?: string;
    VVV_AI_HEALTH_URL?: string;
    VVV_AI_API_KEY?: string;
    MCP_ENABLED?: string;
    MCP_HEALTH_URL?: string;
    ACP_ENABLED?: string;
    ACP_HEALTH_URL?: string;
    A2A_ENABLED?: string;
    A2A_HEALTH_URL?: string;
    AUI_ENABLED?: string;
    AUI_HEALTH_URL?: string;
    GROK_API_KEY?: string;
    GROK_ENDPOINT?: string;
    GROK_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_ENDPOINT?: string;
    OPENAI_MODEL?: string;
    ANTHROPIC_API_KEY?: string;
    CLAUDE_API_KEY?: string;
    ANTHROPIC_ENDPOINT?: string;
    ANTHROPIC_MODEL?: string;
    OPENROUTER_API_KEY?: string;
    OPEN_ROUTER_API_KEY?: string;
    OPENROUTER_ENDPOINT?: string;
    OPENROUTER_MODEL?: string;
    GROQ_API_KEY?: string;
    GROC_API_KEY?: string;
    GROQ_ENDPOINT?: string;
    GROC_ENDPOINT?: string;
    GROQ_MODEL?: string;
    GROC_MODEL?: string;
    GEMINI_API_KEY?: string;
    GOOGLE_GEMINI_API_KEY?: string;
    GEMINI_ENDPOINT?: string;
    GEMINI_MODEL?: string;
    MISTRAL_API_KEY?: string;
    MISTRALAI_API_KEY?: string;
    MISTRAL_ENDPOINT?: string;
    MISTRAL_MODEL?: string;
    MISTRALAI_MODEL?: string;
    CEREBRAS_API_KEY?: string;
    CEREBRAS_ENDPOINT?: string;
    CEREBRAS_MODEL?: string;
    NVIDIA_API_KEY?: string;
    NIM_API_KEY?: string;
    NVIDIA_ENDPOINT?: string;
    NIM_ENDPOINT?: string;
    NVIDIA_MODEL?: string;
    NIM_MODEL?: string;
    LLAMA_API_KEY?: string;
    LLAMA_ENDPOINT?: string;
    LLAMA_MODEL?: string;
    OLLAMA_ENDPOINT?: string;
    OLLAMA_BASE_URL?: string;
    OLLAMA_MODEL?: string;
    HUGGINGFACE_API_KEY?: string;
    HUGGINGFACE_ENDPOINT?: string;
    HUGGINGFACE_MODEL?: string;
    CLAWD_ENABLED?: string;
    CLAWD_ENDPOINT?: string;
    CLAWD_API_SECRET?: string;
    CLAWD_HTTP_ENDPOINT?: string;
    CLAWD_HTTP_TOKEN?: string;
    CLAWD_TIMEOUT_MS?: string;
    X_HANDLE?: string;
    X_BEARER_TOKEN?: string;
    X_ACCESS_TOKEN?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    X_REFRESH_TOKEN?: string;
    X_OAUTH_TOKEN_URL?: string;
    X_AUTOMATION_SECRET?: string;
    X_DRY_RUN?: string;
    X_FORCE?: string;
    X_POST_COOLDOWN_MINUTES?: string;
    X_POST_DAILY_LIMIT?: string;
    PREDICTION_MIN_EDGE_FOR_ACTION?: string;
    PREDICTION_MIN_RELIABILITY_FOR_ACTION?: string;
    PREDICTION_CALIBRATION_GUARD_BRIER?: string;
    MIN_PAYOUT_ETH?: string;
    MIN_PAYOUT_ETH_ETH_MAINNET?: string;
    MIN_PAYOUT_ETH_BASE_MAINNET?: string;
    MIN_PAYOUT_ETH_OPT_MAINNET?: string;
    MIN_PAYOUT_ETH_ARB_MAINNET?: string;
    MIN_PAYOUT_ETH_POLYGON_MAINNET?: string;
    MIN_PAYOUT_GAS_MULTIPLIER?: string;
    MIN_PAYOUT_GAS_MULTIPLIER_ETH_MAINNET?: string;
    MIN_PAYOUT_GAS_MULTIPLIER_BASE_MAINNET?: string;
    MIN_PAYOUT_GAS_MULTIPLIER_OPT_MAINNET?: string;
    MIN_PAYOUT_GAS_MULTIPLIER_ARB_MAINNET?: string;
    MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET?: string;
    GEOPOLITICAL_FEED_ENABLED?: string;
    GEOPOLITICAL_QUERY?: string;
    GEO_RISK_ALERT_THRESHOLD?: string;
    FORECAST_ENSEMBLE_HORIZONS?: string;
    POLICY_LOOKBACK_HOURS?: string;
    POLICY_AUTO_REDEPLOY?: string;
    RAILWAY_TOKEN?: string;
    RAILWAY_PROJECT_ID?: string;
    RAILWAY_SERVICE_ID?: string;
    RAILWAY_ENVIRONMENT_ID?: string;
    RAILWAY_PUBLIC_DOMAIN?: string;
    AUTONOMY_ADMIN_KEY?: string;
    CONTINUOUS_FORECAST_HORIZONS?: string;
    CONTINUOUS_POLICY_LIMIT?: string;
    CONTINUOUS_ENABLE_INGEST?: string;
    CONTINUOUS_INGEST_MIN_INTERVAL_HOURS?: string;
    PREDICTION_MARKET_FEED_ENABLED?: string;
    PREDICTION_MARKET_ENDPOINT?: string;
    PREDICTION_MARKET_LIMIT?: string;
    MAX_INTELLIGENCE_MODE?: string;
    AUTONOMY_MAX_MODE?: string;
    AUTONOMY_APPROVAL_MODE?: string;
    CHAMPION_MAX_MODEL_COUNT?: string;
    CHAMPION_MIN_USES?: string;
    AI_QUERY_BUDGET_USD?: string;
    AI_CRITICAL_QUERY_BUDGET_USD?: string;
    AI_MODEL_COST_PER_1K_TOKENS?: string;
    AI_MIN_MODEL_COUNT?: string;
    AI_MAX_MODEL_COUNT?: string;
    AI_CRITICAL_MIN_MODEL_COUNT?: string;
    AI_CRITICAL_MAX_MODEL_COUNT?: string;
    AI_ESCALATION_AGREEMENT_THRESHOLD?: string;
    AI_ESCALATION_CONFIDENCE_THRESHOLD?: string;
    RAILWAY_ENVIRONMENT?: string;

    // ─── MultiversX (xPortal) ─────────────────────────────────────────
    MVX_ENABLED?: string;
    MVX_DRY_RUN?: string;
    MVX_WALLET_ADDRESS?: string;
    MVX_WALLET_PEM?: string;
    MVX_NETWORK?: string;
    MVX_MIN_STAKE_EGLD?: string;
    MVX_MAX_STAKE_PCT?: string;
    MVX_MIN_BALANCE_EGLD?: string;
    MVX_AUTO_CLAIM_REWARDS?: string;
    MVX_AUTO_STAKE_IDLE?: string;
    MVX_PREFERRED_VALIDATOR?: string;
    MVX_CHECK_INTERVAL_SEC?: string;
    MVX_TIMEOUT_MS?: string;
    MVX_STATE_FILE?: string;

    // ─── Solana ───────────────────────────────────────────────────────
    SOLANA_RPC_URL?: string;
    SOLANA_WALLET_ADDRESS?: string;
    SOLANA_PRIVATE_KEY?: string;
    SOLANA_NETWORK?: string;

    // ─── DeFi Multi-Chain ─────────────────────────────────────────────
    DEFI_MULTICHAIN_ENABLED?: string;
    DEFI_MIN_APY?: string;
    DEFI_MAX_CHAIN_ALLOCATION_PCT?: string;

    // ─── Alpaca Markets ───────────────────────────────────────────────
    ALPACA_ENABLED?: string;
    ALPACA_DRY_RUN?: string;
    ALPACA_API_KEY?: string;
    ALPACA_API_SECRET?: string;
    ALPACA_BASE_URL?: string;
    ALPACA_DATA_URL?: string;
    ALPACA_SYMBOLS?: string;
    ALPACA_ORDER_USD?: string;
    ALPACA_MAX_ORDER_USD?: string;
    ALPACA_MIN_CONFIDENCE?: string;
    ALPACA_MAX_ORDERS_PER_CYCLE?: string;
    ALPACA_MIN_INTERVAL_SEC?: string;
    ALPACA_SIDE_MODE?: string;
    ALPACA_TIMEOUT_MS?: string;
    ALPACA_STATE_FILE?: string;
    ALPACA_USE_COMPOSITE_SIGNAL?: string;

    // ─── Interactive Brokers ──────────────────────────────────────────
    IBKR_ENABLED?: string;
    IBKR_DRY_RUN?: string;
    IBKR_GATEWAY_URL?: string;
    IBKR_ACCOUNT_ID?: string;
    IBKR_SYMBOLS?: string;
    IBKR_ORDER_USD?: string;
    IBKR_MAX_ORDER_USD?: string;
    IBKR_MIN_CONFIDENCE?: string;
    IBKR_MAX_ORDERS_PER_CYCLE?: string;
    IBKR_MIN_INTERVAL_SEC?: string;
    IBKR_SIDE_MODE?: string;
    IBKR_TIMEOUT_MS?: string;
    IBKR_STATE_FILE?: string;

    // ─── Kalshi Prediction Markets ────────────────────────────────────
    KALSHI_ENABLED?: string;
    KALSHI_API_KEY?: string;
    KALSHI_API_SECRET?: string;
    KALSHI_BASE_URL?: string;

    // ─── Overtime Sports Markets ──────────────────────────────────────
    OVERTIME_ENABLED?: string;
    OVERTIME_API_URL?: string;
    OVERTIME_NETWORK?: string;

    // ─── Augur Decentralized Markets ──────────────────────────────────
    AUGUR_ENABLED?: string;
    AUGUR_NETWORK?: string;
    AUGUR_SUBGRAPH_URL?: string;
    AUGUR_POLYGON_SUBGRAPH?: string;

    // ─── Multi-Prediction Engine ──────────────────────────────────────
    MULTI_PRED_ENABLED?: string;
    MULTI_PRED_DRY_RUN?: string;
    MULTI_PRED_MIN_EDGE?: string;
    MULTI_PRED_MAX_ORDER_USD?: string;
    MULTI_PRED_CHECK_INTERVAL_SEC?: string;
    MULTI_PRED_STATE_FILE?: string;

    // ─── Plaid (Fiat Banking Rails) ───────────────────────────────────
    PLAID_CLIENT_ID?: string;
    PLAID_SECRET?: string;
    PLAID_ENV?: string;
    PLAID_ACCESS_TOKEN?: string;

    // ─── DeFi Yield Engine ────────────────────────────────────────────
    DEFI_YIELD_ENABLED?: string;
    DEFI_YIELD_DRY_RUN?: string;
    DEFI_YIELD_MIN_IDLE_USD?: string;
    DEFI_YIELD_MAX_DEPOSIT_PCT?: string;
    DEFI_YIELD_MIN_APY?: string;
    DEFI_YIELD_PROTOCOL?: string;
    DEFI_YIELD_NETWORK?: string;
    DEFI_YIELD_CHECK_INTERVAL_SEC?: string;
    DEFI_YIELD_STATE_FILE?: string;
  }
}
