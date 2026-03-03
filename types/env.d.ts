declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
    DASHBOARD_USER?: string;
    DASHBOARD_PASS?: string;
    ALCHEMY_API_KEY?: string;
    VERCEL?: string;
  }
}
