/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — REST Adapter
   Generic REST API adapter for modern enterprise system integrations
   ═══════════════════════════════════════════════════════════════════════════ */

import type { ConnectorHealth } from '../types/enterprise-types';

export interface RestAdapterConfig {
  baseUrl: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export interface RestRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface RestResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export class RestAdapter {
  private config: Required<RestAdapterConfig>;
  private tokenCache: TokenCache | null = null;
  private authProvider: (() => Promise<TokenCache>) | null = null;

  constructor(config: RestAdapterConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      timeout: config.timeout ?? 30000,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      headers: config.headers ?? {},
    };
  }

  /**
   * Set OAuth/token-based authentication provider
   */
  setAuthProvider(provider: () => Promise<TokenCache>): void {
    this.authProvider = provider;
    this.tokenCache = null;
  }

  /**
   * Set static API key authentication
   */
  setApiKey(apiKey: string, headerName = 'X-API-Key'): void {
    this.config.headers[headerName] = apiKey;
  }

  /**
   * Set basic authentication
   */
  setBasicAuth(username: string, password: string): void {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    this.config.headers['Authorization'] = `Basic ${encoded}`;
  }

  /**
   * Get a fresh access token (with caching)
   */
  private async getAccessToken(): Promise<string | null> {
    if (!this.authProvider) return null;

    // Return cached token if still valid (with 60s buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60000) {
      return this.tokenCache.accessToken;
    }

    // Fetch new token
    this.tokenCache = await this.authProvider();
    return this.tokenCache.accessToken;
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.config.baseUrl);
    
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Execute an HTTP request with retry logic
   */
  async request<T>(options: RestRequestOptions): Promise<RestResponse<T>> {
    const { method = 'GET', path, params, body, headers = {}, timeout } = options;

    const url = this.buildUrl(path, params);
    const requestTimeout = timeout ?? this.config.timeout;

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.config.headers,
      ...headers,
    };

    // Add OAuth token if available
    const accessToken = await this.getAccessToken();
    if (accessToken) {
      requestHeaders['Authorization'] = `Bearer ${accessToken}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Parse response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        // Handle non-2xx responses
        if (!response.ok) {
          const errorBody = await response.text();
          const error = new Error(`HTTP ${response.status}: ${errorBody}`);
          (error as Error & { status: number }).status = response.status;
          throw error;
        }

        // Parse response body
        const contentType = responseHeaders['content-type'] || '';
        let data: T;

        if (contentType.includes('application/json')) {
          data = await response.json() as T;
        } else {
          data = await response.text() as unknown as T;
        }

        return { data, status: response.status, headers: responseHeaders };

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on client errors (4xx) except 429 (rate limit)
        const status = (lastError as Error & { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw lastError;
        }

        // Don't retry on abort/timeout
        if (lastError.name === 'AbortError') {
          throw new Error(`Request timeout after ${requestTimeout}ms`);
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * Convenience methods
   */
  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const response = await this.request<T>({ method: 'GET', path, params });
    return response.data;
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const response = await this.request<T>({ method: 'POST', path, body, params });
    return response.data;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.request<T>({ method: 'PUT', path, body });
    return response.data;
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.request<T>({ method: 'PATCH', path, body });
    return response.data;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.request<T>({ method: 'DELETE', path });
    return response.data;
  }

  /**
   * Check connectivity to the API
   */
  async healthCheck(pingPath = '/health'): Promise<ConnectorHealth> {
    const start = Date.now();
    
    try {
      await this.request({ method: 'GET', path: pingPath, timeout: 5000 });
      
      return {
        status: 'connected',
        lastCheck: new Date(),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'error',
        lastCheck: new Date(),
        latencyMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}

/**
 * Factory function for creating REST adapters with OAuth2 client credentials
 */
export function createOAuth2Adapter(config: {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  timeout?: number;
}): RestAdapter {
  const adapter = new RestAdapter({
    baseUrl: config.baseUrl,
    timeout: config.timeout,
  });

  adapter.setAuthProvider(async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...(config.scope && { scope: config.scope }),
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth2 token request failed: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      refreshToken: data.refresh_token,
    };
  });

  return adapter;
}
