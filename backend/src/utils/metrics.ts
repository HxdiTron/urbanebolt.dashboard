import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// ============================================================
// SYNC METRICS
// ============================================================

export const syncTotal = new Counter({
    name: 'tracking_sync_total',
    help: 'Total tracking sync attempts',
    labelNames: ['status', 'reason'] as const,
    registers: [registry],
});

export const syncDuration = new Histogram({
    name: 'tracking_sync_duration_seconds',
    help: 'Duration of tracking sync operations',
    labelNames: ['status'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
});

export const apiLatency = new Histogram({
    name: 'tracking_api_latency_seconds',
    help: 'Third-party API response latency',
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

export const concurrentRequests = new Gauge({
    name: 'tracking_concurrent_requests',
    help: 'Current number of concurrent API requests',
    registers: [registry],
});

export const rateLimitUsage = new Gauge({
    name: 'tracking_rate_limit_usage',
    help: 'Current rate limit usage (requests per minute)',
    registers: [registry],
});

export const skippedUnchanged = new Counter({
    name: 'tracking_skipped_unchanged_total',
    help: 'Syncs skipped because data unchanged',
    registers: [registry],
});

export const circuitBreakerState = new Gauge({
    name: 'tracking_circuit_breaker_open',
    help: 'Circuit breaker state (1=open, 0=closed)',
    registers: [registry],
});

// ============================================================
// QUEUE METRICS
// ============================================================

export const queueSize = new Gauge({
    name: 'tracking_queue_size',
    help: 'Number of jobs in the queue',
    labelNames: ['status'] as const,
    registers: [registry],
});

export const jobDuration = new Histogram({
    name: 'tracking_job_duration_seconds',
    help: 'Duration of job processing',
    buckets: [1, 5, 10, 30, 60, 120, 300],
    registers: [registry],
});

// ============================================================
// DATABASE METRICS
// ============================================================

export const dbQueryDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query duration',
    labelNames: ['operation'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
});

export const dbConnections = new Gauge({
    name: 'db_connections_active',
    help: 'Number of active database connections',
    registers: [registry],
});

// ============================================================
// API METRICS
// ============================================================

export const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
});

export const httpRequestTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
});

export default {
    registry,
    syncTotal,
    syncDuration,
    apiLatency,
    concurrentRequests,
    rateLimitUsage,
    skippedUnchanged,
    circuitBreakerState,
    queueSize,
    jobDuration,
    dbQueryDuration,
    dbConnections,
    httpRequestDuration,
    httpRequestTotal,
};
