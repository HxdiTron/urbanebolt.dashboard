import { Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import { CONFIG } from '../config';
import { query } from '../db';
import { logger } from '../utils/logger';
import {
    redisConnection,
    rateLimiter,
    concurrencyLimiter,
    circuitBreaker,
    SyncJobData,
} from '../queue/tracking-queue';
import {
    syncTotal,
    syncDuration,
    apiLatency,
    concurrentRequests,
    skippedUnchanged,
    circuitBreakerState,
} from '../utils/metrics';

// ============================================================
// API CLIENT
// ============================================================
async function fetchTracking(awb: string): Promise<any> {
    const requestId = `${awb}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    // Wait for rate limit slot
    const gotSlot = await rateLimiter.waitForSlot(30000);
    if (!gotSlot) {
        throw new Error('Rate limit timeout - could not acquire slot');
    }
    
    // Acquire concurrency slot
    let acquired = false;
    let attempts = 0;
    while (!acquired && attempts < 100) {
        acquired = await concurrencyLimiter.acquire(requestId);
        if (!acquired) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
    }
    
    if (!acquired) {
        throw new Error('Concurrency limit timeout - could not acquire slot');
    }
    
    try {
        concurrentRequests.inc();
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
        
        const response = await fetch(
            `${CONFIG.API_BASE_URL}/api/v1/services/tracking/?awb=${awb}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            }
        );
        
        clearTimeout(timeout);
        
        const latency = (Date.now() - startTime) / 1000;
        apiLatency.observe(latency);
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as {
            status: string;
            data?: any[];
            error?: string;
        };
        
        if (data.status !== 'Success' || !data.data?.[0]) {
            throw new Error(data.error || 'Invalid API response - no data');
        }
        
        await circuitBreaker.recordSuccess();
        return data.data[0];
        
    } finally {
        await concurrencyLimiter.release(requestId);
        concurrentRequests.dec();
    }
}

// ============================================================
// CHANGE DETECTION
// ============================================================
function computeDataHash(data: any): string {
    const relevantData = {
        statusCode: data.currentStatusCode,
        statusDateTime: data.currentStatusDateTime,
        currentLocation: data.currentLocation,
        isRto: data.isRto,
        scansCount: data.scans?.length || 0,
    };
    
    return createHash('sha256')
        .update(JSON.stringify(relevantData))
        .digest('hex');
}

// ============================================================
// SYNC SINGLE AWB
// ============================================================
async function syncSingleAwb(
    awb: string,
    batchId: string
): Promise<{ success: boolean; changed: boolean; error?: string }> {
    const endTimer = syncDuration.startTimer();
    
    try {
        // Check circuit breaker
        if (await circuitBreaker.isOpen()) {
            circuitBreakerState.set(1);
            throw new Error('Circuit breaker is open - API temporarily unavailable');
        }
        circuitBreakerState.set(0);
        
        // Fetch from API
        const apiData = await fetchTracking(awb);
        
        // Compute hash for change detection
        const newHash = computeDataHash(apiData);
        
        // Check if data changed
        const existing = await query(
            'SELECT data_hash FROM shipments WHERE awb = $1',
            [awb]
        );
        
        if (existing.rows[0]?.data_hash === newHash) {
            // Data unchanged - skip update, just update sync time
            await query(`
                UPDATE shipments 
                SET last_synced_at = NOW(),
                    next_sync_at = calculate_next_sync(status_code, sync_failures),
                    sync_failures = 0
                WHERE awb = $1
            `, [awb]);
            
            skippedUnchanged.inc();
            syncTotal.inc({ status: 'skipped', reason: 'unchanged' });
            endTimer({ status: 'skipped' });
            
            logger.debug({ awb, batchId }, 'Skipped - data unchanged');
            return { success: true, changed: false };
        }
        
        // Data changed - full update
        await query(`
            INSERT INTO shipments (
                awb, status_code, status_desc, current_location,
                shipper_name, origin, destination, product_type,
                weight, is_rto, raw_data, data_hash,
                last_synced_at, next_sync_at, sync_failures
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 
                      calculate_next_sync($2, 0::SMALLINT), 0)
            ON CONFLICT (awb) DO UPDATE SET
                status_code = EXCLUDED.status_code,
                status_desc = EXCLUDED.status_desc,
                current_location = EXCLUDED.current_location,
                shipper_name = EXCLUDED.shipper_name,
                origin = EXCLUDED.origin,
                destination = EXCLUDED.destination,
                product_type = EXCLUDED.product_type,
                weight = EXCLUDED.weight,
                is_rto = EXCLUDED.is_rto,
                raw_data = EXCLUDED.raw_data,
                data_hash = EXCLUDED.data_hash,
                last_synced_at = NOW(),
                next_sync_at = calculate_next_sync(EXCLUDED.status_code, 0::SMALLINT),
                sync_failures = 0,
                last_error = NULL
        `, [
            String(apiData.awbNumber),
            apiData.currentStatusCode,
            apiData.currentStatusCodeDescription,
            apiData.currentLocation,
            apiData.shipperName,
            apiData.origin,
            apiData.destination,
            apiData.productType,
            apiData.weight,
            apiData.isRto,
            JSON.stringify(apiData),
            newHash,
        ]);
        
        // Log sync result
        await query(`
            INSERT INTO sync_logs (batch_id, awb, success, changed, response_time_ms)
            VALUES ($1::UUID, $2, TRUE, TRUE, $3)
        `, [batchId, awb, Date.now()]);
        
        syncTotal.inc({ status: 'success', reason: 'updated' });
        endTimer({ status: 'success' });
        
        logger.info({ awb, batchId, status: apiData.currentStatusCode }, 'Synced successfully');
        return { success: true, changed: true };
        
    } catch (error: any) {
        await circuitBreaker.recordFailure();
        
        // Update failure count with exponential backoff
        await query(`
            UPDATE shipments 
            SET sync_failures = LEAST(sync_failures + 1, 10),
                last_error = $2,
                next_sync_at = calculate_next_sync(status_code, LEAST(sync_failures + 1, 10)::SMALLINT)
            WHERE awb = $1
        `, [awb, error.message]);
        
        // Log failure
        await query(`
            INSERT INTO sync_logs (batch_id, awb, success, error_code, error_message)
            VALUES ($1::UUID, $2, FALSE, $3, $4)
        `, [batchId, awb, error.code || 'UNKNOWN', error.message]);
        
        syncTotal.inc({ status: 'failed', reason: error.code || 'unknown' });
        endTimer({ status: 'failed' });
        
        logger.error({ awb, batchId, error: error.message }, 'Sync failed');
        return { success: false, changed: false, error: error.message };
    }
}

// ============================================================
// BATCH PROCESSOR
// ============================================================
async function processBatch(awbs: string[], batchId: string): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
}> {
    const results = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    
    for (const awb of awbs) {
        const result = await syncSingleAwb(awb, batchId);
        results.processed++;
        
        if (result.success) {
            results.succeeded++;
            if (!result.changed) {
                results.skipped++;
            }
        } else {
            results.failed++;
        }
        
        // Small delay between requests
        await new Promise(r => setTimeout(r, 50));
    }
    
    return results;
}

// ============================================================
// WORKER DEFINITION
// ============================================================
export const worker = new Worker<SyncJobData>(
    'tracking-sync',
    async (job: Job<SyncJobData>) => {
        const { type, awbs, batchId = job.id } = job.data;
        
        logger.info({
            jobId: job.id,
            batchId,
            type,
            awbCount: awbs.length,
        }, 'Starting sync job');
        
        // Create batch record
        await query(`
            INSERT INTO sync_batches (batch_id, total_awbs, status, started_at)
            VALUES ($1::UUID, $2, 'running', NOW())
            ON CONFLICT (batch_id) DO UPDATE SET status = 'running', started_at = NOW()
        `, [batchId, awbs.length]);
        
        try {
            const results = await processBatch(awbs, batchId!);
            
            // Update batch record
            await query(`
                UPDATE sync_batches 
                SET status = 'completed',
                    completed_at = NOW(),
                    processed = $2,
                    succeeded = $3,
                    failed = $4,
                    skipped = $5
                WHERE batch_id = $1::UUID
            `, [batchId, results.processed, results.succeeded, results.failed, results.skipped]);
            
            logger.info({ jobId: job.id, batchId, ...results }, 'Sync job completed');
            
            return results;
            
        } catch (error: any) {
            await query(`
                UPDATE sync_batches 
                SET status = 'failed', completed_at = NOW()
                WHERE batch_id = $1::UUID
            `, [batchId]);
            
            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 5,
        limiter: {
            max: CONFIG.REQUESTS_PER_MINUTE,
            duration: 60000,
        },
    }
);

// Worker event handlers
worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Worker: Job completed');
});

worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'Worker: Job failed');
});

worker.on('error', (error) => {
    logger.error({ error: error.message }, 'Worker error');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing worker...');
    await worker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing worker...');
    await worker.close();
    process.exit(0);
});

// Start worker if run directly
if (require.main === module) {
    logger.info('Starting tracking sync worker...');
}

export default worker;
