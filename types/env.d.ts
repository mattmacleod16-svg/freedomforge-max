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
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_VOICE_ID?: string;
    ELEVENLABS_MODEL_ID?: string;
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
    MAX_INTELLIGENCE_MODE?: string;
    AUTONOMY_MAX_MODE?: string;
    CHAMPION_MAX_MODEL_COUNT?: string;
    CHAMPION_MIN_USES?: string;
    VERCEL?: string;
  }
}
