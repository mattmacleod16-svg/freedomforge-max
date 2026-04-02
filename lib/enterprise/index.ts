/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Main Entry Point
   
   Unified access to enterprise PLM/MES system integrations:
   - Apriso (DELMIA) — MES, Shop Floor, Quality
   - Oracle — ERP, Manufacturing, Analytics
   - Windchill — PLM, BOM, ECN (future)
   - NextGenPLM — PLM (future)
   ═══════════════════════════════════════════════════════════════════════════ */

// Types
export * from './types/enterprise-types';

// Adapters
export { RestAdapter, createOAuth2Adapter } from './adapters/rest-adapter';
export type { RestAdapterConfig, RestRequestOptions, RestResponse } from './adapters/rest-adapter';

export { ODataAdapter } from './adapters/odata-adapter';
export type { ODataConfig, ODataQueryOptions } from './adapters/odata-adapter';

export { SoapAdapter } from './adapters/soap-adapter';
export type { SoapConfig, SoapRequestOptions } from './adapters/soap-adapter';

// Connectors
export { AprisoConnector, createAprisoConnector } from './connectors/apriso-connector';
export type { 
  AprisoFilters, 
  AprisoWorkCenter, 
  AprisoShift, 
  AprisoOperator, 
  AprisoProductionMetrics,
} from './connectors/apriso-connector';

export { OracleConnector, createOracleConnector } from './connectors/oracle-connector';
export type {
  OracleOrganization,
  OracleItemMaster,
  OracleWorkOrder,
  OracleOnHandQuantity,
  OraclePurchaseRequisition,
  OraclePurchaseRequisitionLine,
} from './connectors/oracle-connector';

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Manager — Singleton for managing all connectors
// ─────────────────────────────────────────────────────────────────────────────

import { AprisoConnector, createAprisoConnector } from './connectors/apriso-connector';
import { OracleConnector, createOracleConnector } from './connectors/oracle-connector';
import type { ConnectorHealth, EnterpriseConfig } from './types/enterprise-types';

interface EnterpriseStatus {
  apriso: ConnectorHealth | null;
  oracle: ConnectorHealth | null;
  windchill: ConnectorHealth | null;
  nextgenPlm: ConnectorHealth | null;
  lastUpdated: Date;
}

class EnterpriseManager {
  private static instance: EnterpriseManager | null = null;

  private _apriso: AprisoConnector | null = null;
  private _oracle: OracleConnector | null = null;
  private _initialized = false;
  private _status: EnterpriseStatus = {
    apriso: null,
    oracle: null,
    windchill: null,
    nextgenPlm: null,
    lastUpdated: new Date(),
  };

  private constructor() {}

  static getInstance(): EnterpriseManager {
    if (!EnterpriseManager.instance) {
      EnterpriseManager.instance = new EnterpriseManager();
    }
    return EnterpriseManager.instance;
  }

  /**
   * Initialize all connectors from environment variables
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    // Initialize Apriso connector
    this._apriso = createAprisoConnector();
    if (this._apriso) {
      try {
        this._status.apriso = await this._apriso.connect();
      } catch (err) {
        this._status.apriso = {
          status: 'error',
          lastCheck: new Date(),
          errorMessage: err instanceof Error ? err.message : 'Failed to connect',
        };
      }
    }

    // Initialize Oracle connector
    this._oracle = createOracleConnector();
    if (this._oracle) {
      try {
        this._status.oracle = await this._oracle.connect();
      } catch (err) {
        this._status.oracle = {
          status: 'error',
          lastCheck: new Date(),
          errorMessage: err instanceof Error ? err.message : 'Failed to connect',
        };
      }
    }

    this._status.lastUpdated = new Date();
    this._initialized = true;
  }

  /**
   * Initialize with explicit configuration (for testing)
   */
  async initializeWithConfig(config: EnterpriseConfig): Promise<void> {
    if (config.apriso) {
      this._apriso = new AprisoConnector(config.apriso);
      this._status.apriso = await this._apriso.connect();
    }

    if (config.oracle) {
      this._oracle = new OracleConnector(config.oracle);
      this._status.oracle = await this._oracle.connect();
    }

    this._status.lastUpdated = new Date();
    this._initialized = true;
  }

  /**
   * Get connector status
   */
  get status(): EnterpriseStatus {
    return this._status;
  }

  /**
   * Check if any connector is available
   */
  get isAvailable(): boolean {
    return !!(this._apriso || this._oracle);
  }

  /**
   * Get Apriso connector
   */
  get apriso(): AprisoConnector | null {
    return this._apriso;
  }

  /**
   * Get Oracle connector
   */
  get oracle(): OracleConnector | null {
    return this._oracle;
  }

  /**
   * Refresh all connector health statuses
   */
  async refreshStatus(): Promise<EnterpriseStatus> {
    const promises: Promise<void>[] = [];

    if (this._apriso) {
      promises.push(
        this._apriso.checkHealth().then(health => {
          this._status.apriso = health;
        })
      );
    }

    if (this._oracle) {
      promises.push(
        this._oracle.checkHealth().then(health => {
          this._status.oracle = health;
        })
      );
    }

    await Promise.allSettled(promises);
    this._status.lastUpdated = new Date();

    return this._status;
  }

  /**
   * Get a summary for the dashboard
   */
  getSummary(): {
    connectedSystems: string[];
    totalSystems: number;
    overallStatus: 'healthy' | 'degraded' | 'offline';
    lastUpdated: Date;
  } {
    const connectedSystems: string[] = [];
    let hasError = false;

    if (this._status.apriso?.status === 'connected') {
      connectedSystems.push('Apriso');
    } else if (this._status.apriso?.status === 'error') {
      hasError = true;
    }

    if (this._status.oracle?.status === 'connected') {
      connectedSystems.push('Oracle');
    } else if (this._status.oracle?.status === 'error') {
      hasError = true;
    }

    const totalConfigured = [
      this._status.apriso,
      this._status.oracle,
      this._status.windchill,
      this._status.nextgenPlm,
    ].filter(Boolean).length;

    let overallStatus: 'healthy' | 'degraded' | 'offline';
    if (connectedSystems.length === totalConfigured && totalConfigured > 0) {
      overallStatus = 'healthy';
    } else if (connectedSystems.length > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'offline';
    }

    return {
      connectedSystems,
      totalSystems: totalConfigured,
      overallStatus,
      lastUpdated: this._status.lastUpdated,
    };
  }
}

// Export singleton instance
export const enterprise = EnterpriseManager.getInstance();
export { EnterpriseManager };
