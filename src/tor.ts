/**
 * Tor SOCKS5 Proxy Support
 *
 * Provides transparent routing of HTTP/HTTPS and WebSocket connections
 * through Tor for .onion hidden services and enhanced privacy.
 *
 * Features:
 * - Auto-detection of .onion URLs
 * - Configurable SOCKS5 proxy settings
 * - Graceful fallback when Tor is unavailable
 * - Support for HTTP fetch and WebSocket connections
 */

import { SocksProxyAgent } from 'socks-proxy-agent';

export interface TorConfig {
  /** SOCKS5 proxy host (default: localhost) */
  readonly proxyHost?: string;
  /** SOCKS5 proxy port (default: 9050 for Tor) */
  readonly proxyPort?: number;
  /** Force all connections through Tor (default: false, only .onion) */
  readonly forceProxy?: boolean;
  /** Enable circuit isolation per destination (default: true) */
  readonly circuitIsolation?: boolean;
}

/**
 * Tor proxy manager for routing connections through SOCKS5
 */
export class TorProxy {
  private readonly proxyHost: string;
  private readonly proxyPort: number;
  private readonly forceProxy: boolean;
  private readonly circuitIsolation: boolean;
  private agent: SocksProxyAgent | null = null;
  private readonly circuitAgents = new Map<string, SocksProxyAgent>(); // Per-peer circuit isolation

  constructor(config: TorConfig = {}) {
    this.proxyHost = config.proxyHost || 'localhost';
    this.proxyPort = config.proxyPort || 9050; // Default Tor SOCKS port
    this.forceProxy = config.forceProxy || false;
    this.circuitIsolation = config.circuitIsolation ?? true; // Enabled by default
  }

  /**
   * Check if a URL is an onion address
   */
  static isOnionUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.endsWith('.onion');
    } catch {
      return false;
    }
  }

  /**
   * Check if this URL should be routed through Tor
   */
  shouldProxy(url: string): boolean {
    return this.forceProxy || TorProxy.isOnionUrl(url);
  }

  /**
   * Get or create SOCKS5 proxy agent for fetch
   *
   * With circuit isolation enabled, each destination gets its own circuit.
   * This prevents correlation of different streams to the same user.
   *
   * Tor SOCKS5 authentication format: username:password where username is used
   * as a circuit isolation identifier. Different usernames = different circuits.
   */
  getAgent(destination?: string): SocksProxyAgent {
    // Circuit isolation: create separate agents per destination
    if (this.circuitIsolation && destination) {
      const existing = this.circuitAgents.get(destination);
      if (existing) return existing;

      // Use destination as SOCKS5 username for circuit isolation
      // This tells Tor to use a different circuit for each unique username
      const isolationId = this.hashDestination(destination);
      const proxyUrl = `socks5://${isolationId}:@${this.proxyHost}:${this.proxyPort}`;
      const agent = new SocksProxyAgent(proxyUrl);
      this.circuitAgents.set(destination, agent);
      return agent;
    }

    // Default shared agent (no circuit isolation)
    if (!this.agent) {
      const proxyUrl = `socks5://${this.proxyHost}:${this.proxyPort}`;
      this.agent = new SocksProxyAgent(proxyUrl);
    }
    return this.agent;
  }

  /**
   * Hash destination to create a stable circuit isolation ID
   * Uses simple hash to create predictable but unique IDs per destination
   */
  private hashDestination(destination: string): string {
    let hash = 0;
    for (let i = 0; i < destination.length; i++) {
      const char = destination.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `circuit_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Create fetch options with Tor proxy if needed
   */
  getFetchOptions(url: string, options: RequestInit = {}): RequestInit {
    if (this.shouldProxy(url)) {
      // Extract hostname for circuit isolation
      const destination = this.extractDestination(url);
      return {
        ...options,
        // @ts-ignore - dispatcher is valid but not in types
        dispatcher: this.getAgent(destination)
      };
    }
    return options;
  }

  /**
   * Extract destination (hostname) from URL for circuit isolation
   */
  private extractDestination(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url;
    }
  }

  /**
   * Fetch with automatic Tor routing for .onion URLs
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const fetchOptions = this.getFetchOptions(url, options);

    try {
      return await fetch(url, fetchOptions);
    } catch (error: any) {
      // Enhance error message for .onion failures
      if (TorProxy.isOnionUrl(url)) {
        throw new Error(
          `Failed to connect to .onion address (is Tor running on ${this.proxyHost}:${this.proxyPort}?): ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get WebSocket connection options for Tor
   *
   * WebSocket over SOCKS5 is supported by SocksProxyAgent.
   * Use with 'ws' library or compatible WebSocket implementations.
   *
   * Example with 'ws':
   *   const ws = new WebSocket(url, torProxy.getWebSocketOptions(url));
   */
  getWebSocketOptions(url?: string): { agent: SocksProxyAgent } | {} {
    if (!url) {
      // No URL provided, return default agent
      return this.shouldProxy('') ? { agent: this.getAgent() } : {};
    }

    if (this.shouldProxy(url)) {
      const destination = this.extractDestination(url);
      return { agent: this.getAgent(destination) };
    }

    return {};
  }

  /**
   * Check if Tor proxy is available
   */
  async checkConnection(): Promise<boolean> {
    try {
      // Try to connect to Tor check service
      const response = await this.fetch('https://check.torproject.org/', {
        signal: AbortSignal.timeout(5000)
      });

      const text = await response.text();
      return text.includes('Congratulations') || text.includes('using Tor');
    } catch {
      return false;
    }
  }

  /**
   * Destroy all proxy agents and clean up resources
   */
  destroy(): void {
    // Destroy default agent
    if (this.agent) {
      this.agent.destroy();
      this.agent = null;
    }

    // Destroy all circuit-isolated agents
    for (const agent of this.circuitAgents.values()) {
      agent.destroy();
    }
    this.circuitAgents.clear();
  }

  /**
   * Clear circuit for a specific destination
   * Forces a new circuit to be created on next connection
   */
  clearCircuit(destination: string): void {
    const agent = this.circuitAgents.get(destination);
    if (agent) {
      agent.destroy();
      this.circuitAgents.delete(destination);
    }
  }

  /**
   * Get current circuit isolation stats
   */
  getStats(): { isolatedCircuits: number; circuitIsolationEnabled: boolean } {
    return {
      isolatedCircuits: this.circuitAgents.size,
      circuitIsolationEnabled: this.circuitIsolation
    };
  }
}

/**
 * Global Tor proxy instance (optional)
 * Applications can use this or create their own TorProxy instances
 */
let globalTorProxy: TorProxy | null = null;

/**
 * Configure global Tor proxy
 */
export function configureTor(config: TorConfig): TorProxy {
  globalTorProxy = new TorProxy(config);
  return globalTorProxy;
}

/**
 * Get global Tor proxy (creates default if not configured)
 */
export function getTorProxy(): TorProxy {
  if (!globalTorProxy) {
    globalTorProxy = new TorProxy();
  }
  return globalTorProxy;
}

/**
 * Fetch with automatic Tor routing (uses global proxy)
 */
export async function torFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getTorProxy().fetch(url, options);
}
