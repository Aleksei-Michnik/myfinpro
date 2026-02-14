import { Injectable } from '@nestjs/common';

interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: number;
}

export interface MetricsSummary {
  uptime: number;
  requests: {
    total: number;
    byMethod: Record<string, number>;
    byStatusCode: Record<string, number>;
    byPath: Record<string, number>;
  };
  errors: {
    total: number;
    byStatusCode: Record<string, number>;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  activeConnections: number;
}

@Injectable()
export class MetricsService {
  private readonly startTime = Date.now();
  private readonly durations: number[] = [];
  private totalRequests = 0;
  private readonly requestsByMethod: Map<string, number> = new Map();
  private readonly requestsByStatusCode: Map<number, number> = new Map();
  private readonly requestsByPath: Map<string, number> = new Map();
  private totalErrors = 0;
  private readonly errorsByStatusCode: Map<number, number> = new Map();
  private activeConnections = 0;

  // Keep only last N durations for percentile calculations
  private readonly maxDurations = 10_000;

  recordRequest(metric: RequestMetric): void {
    this.totalRequests++;

    // Track by method
    const methodCount = this.requestsByMethod.get(metric.method) || 0;
    this.requestsByMethod.set(metric.method, methodCount + 1);

    // Track by status code
    const statusCount = this.requestsByStatusCode.get(metric.statusCode) || 0;
    this.requestsByStatusCode.set(metric.statusCode, statusCount + 1);

    // Track by path (normalize to avoid cardinality explosion)
    const normalizedPath = this.normalizePath(metric.path);
    const pathCount = this.requestsByPath.get(normalizedPath) || 0;
    this.requestsByPath.set(normalizedPath, pathCount + 1);

    // Track duration
    this.durations.push(metric.duration);
    if (this.durations.length > this.maxDurations) {
      this.durations.splice(0, this.durations.length - this.maxDurations);
    }

    // Track errors
    if (metric.statusCode >= 400) {
      this.totalErrors++;
      const errCount = this.errorsByStatusCode.get(metric.statusCode) || 0;
      this.errorsByStatusCode.set(metric.statusCode, errCount + 1);
    }
  }

  incrementErrors(statusCode: number): void {
    this.totalErrors++;
    const count = this.errorsByStatusCode.get(statusCode) || 0;
    this.errorsByStatusCode.set(statusCode, count + 1);
  }

  incrementActiveConnections(): void {
    this.activeConnections++;
  }

  decrementActiveConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  getMetrics(): MetricsSummary {
    const sorted = [...this.durations].sort((a, b) => a - b);

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      requests: {
        total: this.totalRequests,
        byMethod: Object.fromEntries(this.requestsByMethod),
        byStatusCode: Object.fromEntries(
          [...this.requestsByStatusCode.entries()].map(([k, v]) => [String(k), v]),
        ),
        byPath: Object.fromEntries(this.requestsByPath),
      },
      errors: {
        total: this.totalErrors,
        byStatusCode: Object.fromEntries(
          [...this.errorsByStatusCode.entries()].map(([k, v]) => [String(k), v]),
        ),
      },
      latency: {
        p50: this.percentile(sorted, 50),
        p95: this.percentile(sorted, 95),
        p99: this.percentile(sorted, 99),
        avg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
      },
      activeConnections: this.activeConnections,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.requestsByMethod.clear();
    this.requestsByStatusCode.clear();
    this.requestsByPath.clear();
    this.totalErrors = 0;
    this.errorsByStatusCode.clear();
    this.durations.length = 0;
    this.activeConnections = 0;
  }

  private normalizePath(path: string): string {
    // Remove query string
    const basePath = path.split('?')[0];
    // Replace UUIDs and numeric IDs with :id
    return basePath
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:id');
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}
