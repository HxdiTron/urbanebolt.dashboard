import { CronJob } from 'cron';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config';
import { query } from '../db';
import { logger } from '../utils/logger';
import { trackingQueue } from '../queue/tracking-queue';

// ============================================================
// SMART SCHEDULING: Prioritize by status & freshness
// ============================================================
async function getAwbsToSync(limit: number = 1000): Promise<string[]> {
    const result = await query(`
        SELECT awb FROM shipments
        WHERE next_sync_at <= NOW()
          AND sync_failures < 10
        ORDER BY 
            sync_priority ASC,
            next_sync_at ASC,
            sync_failures ASC
        LIMIT $1
    `, [limit]);
    
    return result.rows.map(r => r.awb);
}

// ============================================================
// ENQUEUE SYNC BATCHES
// ============================================================
async function enqueueSyncJobs(): Promise<void> {
    const startTime = Date.now();
    const batchId = uuidv4();
    
    logger.info({ batchId }, 'Starting scheduled sync');
    
    try {
        const awbs = await getAwbsToSync(10000);
        
        if (awbs.length === 0) {
            logger.info({ batchId }, 'No AWBs need syncing');
            return;
        }
        
        // Split into batches of 20
        const batches: string[][] = [];
        for (let i = 0; i < awbs.length; i += CONFIG.BATCH_SIZE) {
            batches.push(awbs.slice(i, i + CONFIG.BATCH_SIZE));
        }
        
        // Enqueue all batches
        const jobs = batches.map((batch, index) => ({
            name: `sync-batch-${batchId}-${index}`,
            data: {
                type: 'batch' as const,
                awbs: batch,
                batchId: `${batchId}`,
            },
            opts: {
                priority: 5,
                delay: index * 1000, // Stagger by 1s
            },
        }));
        
        await trackingQueue.addBulk(jobs);
        
        const duration = Date.now() - startTime;
        logger.info({
            batchId,
            totalAwbs: awbs.length,
            batchCount: batches.length,
            durationMs: duration,
        }, 'Scheduled sync jobs enqueued');
        
    } catch (error: any) {
        logger.error({ batchId, error: error.message }, 'Failed to enqueue sync jobs');
    }
}

// ============================================================
// PRIORITY SYNC (Active shipments)
// ============================================================
async function enqueuePrioritySync(): Promise<void> {
    try {
        const result = await query(`
            SELECT awb FROM shipments
            WHERE status_code IN ('OFD', 'UDD', 'DDS')
              AND next_sync_at <= NOW()
            LIMIT 100
        `);
        
        if (result.rows.length > 0) {
            const awbs = result.rows.map(r => r.awb);
            await trackingQueue.add('priority-sync', {
                type: 'priority',
                awbs,
                batchId: uuidv4(),
            }, { priority: 1 });
            
            logger.info({ count: awbs.length }, 'Priority sync enqueued');
        }
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to enqueue priority sync');
    }
}

// ============================================================
// CLEANUP OLD LOGS
// ============================================================
async function cleanupOldLogs(): Promise<void> {
    try {
        const logsResult = await query(`
            DELETE FROM sync_logs WHERE created_at < NOW() - INTERVAL '7 days'
        `);
        
        const batchesResult = await query(`
            DELETE FROM sync_batches WHERE created_at < NOW() - INTERVAL '30 days'
        `);
        
        logger.info({
            logsDeleted: logsResult.rowCount,
            batchesDeleted: batchesResult.rowCount,
        }, 'Cleanup completed');
    } catch (error: any) {
        logger.error({ error: error.message }, 'Cleanup failed');
    }
}

// ============================================================
// CRON JOBS
// ============================================================

// Main hourly sync - every hour at minute 0
const hourlySyncJob = new CronJob(
    '0 * * * *',
    enqueueSyncJobs,
    null,
    false,
    'UTC'
);

// Priority sync - every 15 minutes
const prioritySyncJob = new CronJob(
    '*/15 * * * *',
    enqueuePrioritySync,
    null,
    false,
    'UTC'
);

// Cleanup - daily at 3 AM
const cleanupJob = new CronJob(
    '0 3 * * *',
    cleanupOldLogs,
    null,
    false,
    'UTC'
);

// ============================================================
// SCHEDULER CONTROL
// ============================================================
export function startScheduler(): void {
    hourlySyncJob.start();
    prioritySyncJob.start();
    cleanupJob.start();
    logger.info('Scheduler started - jobs scheduled');
    logger.info('  - Hourly sync: 0 * * * * (every hour)');
    logger.info('  - Priority sync: */15 * * * * (every 15 min)');
    logger.info('  - Cleanup: 0 3 * * * (daily at 3 AM)');
}

export function stopScheduler(): void {
    hourlySyncJob.stop();
    prioritySyncJob.stop();
    cleanupJob.stop();
    logger.info('Scheduler stopped');
}

// Manual trigger functions (for API)
export async function triggerHourlySync(): Promise<void> {
    await enqueueSyncJobs();
}

export async function triggerPrioritySync(): Promise<void> {
    await enqueuePrioritySync();
}

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, stopping scheduler...');
    stopScheduler();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, stopping scheduler...');
    stopScheduler();
    process.exit(0);
});

// Start if run directly
if (require.main === module) {
    logger.info('Starting scheduler...');
    startScheduler();
    
    // Also run initial sync after 5 seconds
    setTimeout(() => {
        logger.info('Running initial sync...');
        enqueueSyncJobs();
    }, 5000);
}

export default {
    startScheduler,
    stopScheduler,
    triggerHourlySync,
    triggerPrioritySync,
};
