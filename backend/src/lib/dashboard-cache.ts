/**
 * In-memory cache for dashboard summary. 60s TTL.
 * Invalidated on upload so we never serve stale data after a new batch.
 */

const TTL_MS = 60 * 1000; // 60 seconds

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

let summaryCache: CacheEntry<DashboardSummary> | null = null;

export interface DashboardSummary {
    totalShipments: number;
    deliveredCount: number;
    rtoCount: number;
    inTransitCount: number;
    slaPercentage: number;
    breachCount: number;
    openBreachCount: number;
    revenueAtRisk: number;
    rtoPercentage: number;
}

export function getCachedSummary(): DashboardSummary | null {
    if (!summaryCache) return null;
    if (Date.now() >= summaryCache.expiresAt) {
        summaryCache = null;
        return null;
    }
    return summaryCache.data;
}

export function setCachedSummary(data: DashboardSummary): void {
    summaryCache = {
        data: { ...data },
        expiresAt: Date.now() + TTL_MS,
    };
}

/**
 * Call after successful upload so next summary request hits MongoDB.
 */
export function invalidateDashboardCache(): void {
    summaryCache = null;
}
