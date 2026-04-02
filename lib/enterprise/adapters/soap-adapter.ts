/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — SOAP Adapter
   SOAP/XML adapter for legacy enterprise system integrations (Apriso, SAP, etc.)
   ═══════════════════════════════════════════════════════════════════════════ */

import type { ConnectorHealth } from '../types/enterprise-types';

export interface SoapConfig {
  wsdlUrl?: string;
  endpointUrl: string;
  username?: string;
  password?: string;
  timeout?: number;
  soapVersion?: '1.1' | '1.2';
  namespace?: string;
}

export interface SoapRequestOptions {
  operation: string;
  parameters?: Record<string, unknown>;
  soapAction?: string;
  headers?: Record<string, string>;
}

export class SoapAdapter {
  private config: Required<Omit<SoapConfig, 'wsdlUrl' | 'username' | 'password'>> & {
    wsdlUrl?: string;
    username?: string;
    password?: string;
  };

  constructor(config: SoapConfig) {
    this.config = {
      endpointUrl: config.endpointUrl,
      wsdlUrl: config.wsdlUrl,
      username: config.username,
      password: config.password,
      timeout: config.timeout ?? 30000,
      soapVersion: config.soapVersion ?? '1.1',
      namespace: config.namespace ?? 'http://tempuri.org/',
    };
  }

  /**
   * Build SOAP envelope
   */
  private buildEnvelope(operation: string, parameters?: Record<string, unknown>): string {
    const soapNs = this.config.soapVersion === '1.2'
      ? 'http://www.w3.org/2003/05/soap-envelope'
      : 'http://schemas.xmlsoap.org/soap/envelope/';

    // Build parameters XML
    let paramsXml = '';
    if (parameters) {
      paramsXml = Object.entries(parameters)
        .map(([key, value]) => this.valueToXml(key, value))
        .join('');
    }

    // Add WS-Security header if credentials provided
    let securityHeader = '';
    if (this.config.username && this.config.password) {
      securityHeader = `
        <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
          <wsse:UsernameToken>
            <wsse:Username>${this.escapeXml(this.config.username)}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escapeXml(this.config.password)}</wsse:Password>
          </wsse:UsernameToken>
        </wsse:Security>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${soapNs}" xmlns:ns="${this.config.namespace}">
  <soap:Header>${securityHeader}</soap:Header>
  <soap:Body>
    <ns:${operation}>
      ${paramsXml}
    </ns:${operation}>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Convert a value to XML element
   */
  private valueToXml(key: string, value: unknown, namespace = 'ns'): string {
    if (value === null || value === undefined) {
      return `<${namespace}:${key} xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>`;
    }

    if (Array.isArray(value)) {
      return value.map(item => this.valueToXml(key, item, namespace)).join('');
    }

    if (typeof value === 'object' && value !== null) {
      if (value instanceof Date) {
        return `<${namespace}:${key}>${value.toISOString()}</${namespace}:${key}>`;
      }
      const children = Object.entries(value)
        .map(([k, v]) => this.valueToXml(k, v, namespace))
        .join('');
      return `<${namespace}:${key}>${children}</${namespace}:${key}>`;
    }

    return `<${namespace}:${key}>${this.escapeXml(String(value))}</${namespace}:${key}>`;
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Parse SOAP response XML to object
   */
  private parseResponse<T>(xml: string, operation: string): T {
    // Extract body content (simple regex-based parsing)
    const bodyMatch = xml.match(/<(?:soap|SOAP-ENV):Body[^>]*>([\s\S]*?)<\/(?:soap|SOAP-ENV):Body>/i);
    if (!bodyMatch) {
      throw new Error('Invalid SOAP response: no Body element found');
    }

    const bodyContent = bodyMatch[1];

    // Check for SOAP fault
    const faultMatch = bodyContent.match(/<(?:soap|SOAP-ENV):Fault[^>]*>([\s\S]*?)<\/(?:soap|SOAP-ENV):Fault>/i);
    if (faultMatch) {
      const faultString = this.extractTextContent(faultMatch[1], 'faultstring') ||
                          this.extractTextContent(faultMatch[1], 'Reason') ||
                          'SOAP Fault';
      throw new Error(`SOAP Fault: ${faultString}`);
    }

    // Extract operation response
    const responsePattern = new RegExp(`<[^:]*:?${operation}Response[^>]*>([\\s\\S]*?)<\\/[^:]*:?${operation}Response>`, 'i');
    const responseMatch = bodyContent.match(responsePattern);
    
    if (responseMatch) {
      return this.xmlToObject(responseMatch[1]) as T;
    }

    // Try to parse the body content directly
    return this.xmlToObject(bodyContent) as T;
  }

  /**
   * Extract text content from XML element
   */
  private extractTextContent(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<[^:]*:?${tagName}[^>]*>([^<]*)<\\/[^:]*:?${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Simple XML to object converter
   */
  private xmlToObject(xml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    // Match elements with content
    const elementPattern = /<([^:\s>]+:)?([^>\s\/]+)([^>]*)>([^<]*)<\/\1?\2>/g;
    let match;

    while ((match = elementPattern.exec(xml)) !== null) {
      const [, , tagName, , content] = match;
      const trimmedContent = content.trim();
      
      // Try to parse as number or boolean
      if (/^-?\d+(\.\d+)?$/.test(trimmedContent)) {
        result[tagName] = parseFloat(trimmedContent);
      } else if (trimmedContent === 'true' || trimmedContent === 'false') {
        result[tagName] = trimmedContent === 'true';
      } else {
        result[tagName] = trimmedContent;
      }
    }

    // Match elements with nested content
    const nestedPattern = /<([^:\s>]+:)?([^>\s\/]+)([^>]*)>([\s\S]*?)<\/\1?\2>/g;
    
    while ((match = nestedPattern.exec(xml)) !== null) {
      const [fullMatch, , tagName, , content] = match;
      
      // Skip if already processed as simple element
      if (tagName in result) continue;
      
      // Check if content has nested elements
      if (content.includes('<')) {
        const nested = this.xmlToObject(content);
        if (Object.keys(nested).length > 0) {
          // Handle arrays (multiple elements with same name)
          if (tagName in result) {
            if (!Array.isArray(result[tagName])) {
              result[tagName] = [result[tagName]];
            }
            (result[tagName] as unknown[]).push(nested);
          } else {
            result[tagName] = nested;
          }
        }
      }
    }

    return result;
  }

  /**
   * Execute a SOAP operation
   */
  async call<T>(options: SoapRequestOptions): Promise<T> {
    const { operation, parameters, soapAction, headers = {} } = options;

    const envelope = this.buildEnvelope(operation, parameters);

    // Determine SOAPAction header
    const action = soapAction ?? `${this.config.namespace}${operation}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': this.config.soapVersion === '1.2'
        ? 'application/soap+xml; charset=utf-8'
        : 'text/xml; charset=utf-8',
      'SOAPAction': `"${action}"`,
      ...headers,
    };

    // Add basic auth if no WS-Security
    if (this.config.username && this.config.password && !envelope.includes('wsse:Security')) {
      const encoded = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      requestHeaders['Authorization'] = `Basic ${encoded}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: envelope,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();

      if (!response.ok) {
        // Try to parse SOAP fault from error response
        try {
          this.parseResponse(responseText, operation);
        } catch (faultErr) {
          throw faultErr;
        }
        throw new Error(`SOAP request failed: HTTP ${response.status}`);
      }

      return this.parseResponse<T>(responseText, operation);

    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`SOAP request timeout after ${this.config.timeout}ms`);
      }
      throw err;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();

    try {
      // If WSDL URL is available, fetch it for health check
      if (this.config.wsdlUrl) {
        const response = await fetch(this.config.wsdlUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`WSDL fetch failed: ${response.status}`);
        }

        return {
          status: 'connected',
          lastCheck: new Date(),
          latencyMs: Date.now() - start,
        };
      }

      // Otherwise, just check if endpoint is reachable
      const response = await fetch(this.config.endpointUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      return {
        status: response.ok || response.status === 405 ? 'connected' : 'error',
        lastCheck: new Date(),
        latencyMs: Date.now() - start,
        errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
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
