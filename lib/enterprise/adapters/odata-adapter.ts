/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — OData Adapter
   OData v4 protocol adapter for Oracle, SAP, and Microsoft integrations
   ═══════════════════════════════════════════════════════════════════════════ */

import { RestAdapter, createOAuth2Adapter } from './rest-adapter';
import type { PaginatedResponse } from '../types/enterprise-types';

export interface ODataConfig {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

export interface ODataQueryOptions {
  $select?: string[];
  $filter?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
  $expand?: string[];
  $count?: boolean;
  $search?: string;
}

interface ODataCollectionResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

interface ODataEntityResponse<T> {
  '@odata.context'?: string;
  '@odata.etag'?: string;
}

export class ODataAdapter {
  private rest: RestAdapter;

  constructor(config: ODataConfig) {
    // Use OAuth2 if credentials provided
    if (config.clientId && config.clientSecret && config.tokenUrl) {
      this.rest = createOAuth2Adapter({
        baseUrl: config.baseUrl,
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        timeout: config.timeout,
      });
    } else {
      this.rest = new RestAdapter({
        baseUrl: config.baseUrl,
        timeout: config.timeout,
        headers: {
          'OData-Version': '4.0',
          'OData-MaxVersion': '4.0',
        },
      });

      // Set authentication
      if (config.apiKey) {
        this.rest.setApiKey(config.apiKey);
      } else if (config.username && config.password) {
        this.rest.setBasicAuth(config.username, config.password);
      }
    }
  }

  /**
   * Build OData query string from options
   */
  private buildQueryParams(options?: ODataQueryOptions): Record<string, string | number | boolean | undefined> {
    if (!options) return {};

    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.$select?.length) {
      params.$select = options.$select.join(',');
    }
    if (options.$filter) {
      params.$filter = options.$filter;
    }
    if (options.$orderby) {
      params.$orderby = options.$orderby;
    }
    if (options.$top !== undefined) {
      params.$top = options.$top;
    }
    if (options.$skip !== undefined) {
      params.$skip = options.$skip;
    }
    if (options.$expand?.length) {
      params.$expand = options.$expand.join(',');
    }
    if (options.$count) {
      params.$count = true;
    }
    if (options.$search) {
      params.$search = `"${options.$search}"`;
    }

    return params;
  }

  /**
   * Query an entity set with OData options
   */
  async query<T>(entitySet: string, options?: ODataQueryOptions): Promise<PaginatedResponse<T>> {
    const params = this.buildQueryParams(options);
    
    const response = await this.rest.get<ODataCollectionResponse<T>>(entitySet, params);

    return {
      items: response.value,
      total: response['@odata.count'] ?? response.value.length,
      page: options?.$skip ? Math.floor(options.$skip / (options.$top ?? 100)) + 1 : 1,
      pageSize: options?.$top ?? response.value.length,
      hasMore: !!response['@odata.nextLink'],
    };
  }

  /**
   * Get a single entity by key
   */
  async getById<T>(entitySet: string, key: string | number, options?: Pick<ODataQueryOptions, '$select' | '$expand'>): Promise<T> {
    const path = `${entitySet}(${typeof key === 'string' ? `'${key}'` : key})`;
    const params = this.buildQueryParams(options);
    
    return this.rest.get<T & ODataEntityResponse<T>>(path, params);
  }

  /**
   * Create a new entity
   */
  async create<T>(entitySet: string, entity: Partial<T>): Promise<T> {
    return this.rest.post<T>(entitySet, entity);
  }

  /**
   * Update an entity (full replacement)
   */
  async update<T>(entitySet: string, key: string | number, entity: Partial<T>): Promise<T> {
    const path = `${entitySet}(${typeof key === 'string' ? `'${key}'` : key})`;
    return this.rest.put<T>(path, entity);
  }

  /**
   * Patch an entity (partial update)
   */
  async patch<T>(entitySet: string, key: string | number, changes: Partial<T>): Promise<T> {
    const path = `${entitySet}(${typeof key === 'string' ? `'${key}'` : key})`;
    return this.rest.patch<T>(path, changes);
  }

  /**
   * Delete an entity
   */
  async delete(entitySet: string, key: string | number): Promise<void> {
    const path = `${entitySet}(${typeof key === 'string' ? `'${key}'` : key})`;
    await this.rest.delete(path);
  }

  /**
   * Execute an OData action
   */
  async action<T>(actionPath: string, parameters?: Record<string, unknown>): Promise<T> {
    return this.rest.post<T>(actionPath, parameters);
  }

  /**
   * Execute an OData function
   */
  async function<T>(functionPath: string, parameters?: Record<string, string | number | boolean>): Promise<T> {
    // Functions use query parameters
    return this.rest.get<T>(functionPath, parameters);
  }

  /**
   * Build OData filter expressions
   */
  static filter = {
    eq: (field: string, value: string | number | boolean) => {
      if (typeof value === 'string') {
        return `${field} eq '${value}'`;
      }
      return `${field} eq ${value}`;
    },
    ne: (field: string, value: string | number | boolean) => {
      if (typeof value === 'string') {
        return `${field} ne '${value}'`;
      }
      return `${field} ne ${value}`;
    },
    gt: (field: string, value: number | Date) => {
      if (value instanceof Date) {
        return `${field} gt ${value.toISOString()}`;
      }
      return `${field} gt ${value}`;
    },
    ge: (field: string, value: number | Date) => {
      if (value instanceof Date) {
        return `${field} ge ${value.toISOString()}`;
      }
      return `${field} ge ${value}`;
    },
    lt: (field: string, value: number | Date) => {
      if (value instanceof Date) {
        return `${field} lt ${value.toISOString()}`;
      }
      return `${field} lt ${value}`;
    },
    le: (field: string, value: number | Date) => {
      if (value instanceof Date) {
        return `${field} le ${value.toISOString()}`;
      }
      return `${field} le ${value}`;
    },
    contains: (field: string, value: string) => `contains(${field},'${value}')`,
    startswith: (field: string, value: string) => `startswith(${field},'${value}')`,
    endswith: (field: string, value: string) => `endswith(${field},'${value}')`,
    in: (field: string, values: (string | number)[]) => {
      const formatted = values.map(v => typeof v === 'string' ? `'${v}'` : v).join(',');
      return `${field} in (${formatted})`;
    },
    and: (...conditions: string[]) => conditions.join(' and '),
    or: (...conditions: string[]) => `(${conditions.join(' or ')})`,
    not: (condition: string) => `not (${condition})`,
  };

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; latencyMs: number }> {
    const health = await this.rest.healthCheck('/$metadata');
    return {
      status: health.status,
      latencyMs: health.latencyMs ?? 0,
    };
  }
}
