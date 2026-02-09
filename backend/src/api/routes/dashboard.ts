import { Router, Request, Response } from 'express';
import { query } from '../../db';
import { logger } from '../../utils/logger';
import { rateLimiter, concurrencyLimiter, circuitBreaker, trackingQueue } from '../../queue/tracking-queue';

const router = Router();

// ============================================================
// GET /api/v1/dashboard/stats - Dashboard aggregates
// ============================================================
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status_code = 'DDL') as delivered,
                COUNT(*) FILTER (WHERE status_code IN ('OFD', 'DDS')) as out_for_delivery,
                COUNT(*) FILTER (WHERE status_code IN ('MAN','PKD','IND','BGD','DPD','ARD','RDC','DBG')) as in_transit,
                COUNT(*) FILTER (WHERE status_code = 'RTO' OR is_rto = true) as rto,
                COUNT(*) FILTER (WHERE status_code = 'UDD') as undelivered,
                COUNT(*) FILTER (WHERE status_code = 'CAN') as cancelled,
                COUNT(*) FILTER (WHERE product_type = 'COD') as cod_count,
                COUNT(*) FILTER (WHERE product_type = 'PPD') as ppd_count,
                MAX(last_synced_at) as last_sync,
                AVG(EXTRACT(EPOCH FROM (NOW() - last_synced_at)))::INTEGER as avg_data_age_seconds
            FROM shipments
        `);
        
        const stats = result.rows[0];
        
        // Calculate success rate
        const total = parseInt(stats.total) || 0;
        const delivered = parseInt(stats.delivered) || 0;
        stats.success_rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
        
        res.json({ data: stats });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get stats');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// GET /api/v1/dashboard/status-breakdown - Status distribution
// ============================================================
router.get('/status-breakdown', async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT 
                status_code,
                status_desc,
                COUNT(*) as count
            FROM shipments
            WHERE status_code IS NOT NULL
            GROUP BY status_code, status_desc
            ORDER BY count DESC
        `);
        
        res.json({ data: result.rows });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get status breakdown');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// GET /api/v1/dashboard/sync-status - Sync system status
// ============================================================
router.get('/sync-status', async (req: Request, res: Response) => {
    try {
        // Get queue stats
        const [waiting, active, completed, failed] = await Promise.all([
            trackingQueue.getWaitingCount(),
            trackingQueue.getActiveCount(),
            trackingQueue.getCompletedCount(),
            trackingQueue.getFailedCount(),
        ]);
        
        // Get rate limit and circuit breaker status
        const [rateLimit, concurrent, circuit] = await Promise.all([
            rateLimiter.getUsage(),
            concurrencyLimiter.getCurrent(),
            circuitBreaker.getState(),
        ]);
        
        // Get recent sync batches
        const recentBatches = await query(`
            SELECT batch_id, status, total_awbs, succeeded, failed, skipped,
                   started_at, completed_at,
                   EXTRACT(EPOCH FROM (completed_at - started_at))::INTEGER as duration_seconds
            FROM sync_batches
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // Get pending syncs count
        const pendingSyncs = await query(`
            SELECT COUNT(*) as count FROM shipments
            WHERE next_sync_at <= NOW() AND sync_failures < 10
        `);
        
        res.json({
            data: {
                queue: {
                    waiting,
                    active,
                    completed,
                    failed,
                },
                rateLimit: {
                    used: rateLimit.used,
                    limit: rateLimit.limit,
                    percentage: Math.round((rateLimit.used / rateLimit.limit) * 100),
                },
                concurrency: {
                    current: concurrent,
                    max: 20,
                },
                circuitBreaker: circuit,
                pendingSyncs: parseInt(pendingSyncs.rows[0].count),
                recentBatches: recentBatches.rows,
            },
        });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get sync status');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// GET /api/v1/dashboard/recent-activity - Recent sync activity
// ============================================================
router.get('/recent-activity', async (req: Request, res: Response) => {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    
    try {
        const result = await query(`
            SELECT 
                sl.awb,
                sl.success,
                sl.changed,
                sl.error_message,
                sl.response_time_ms,
                sl.created_at,
                s.status_code,
                s.status_desc
            FROM sync_logs sl
            LEFT JOIN shipments s ON sl.awb = s.awb
            ORDER BY sl.created_at DESC
            LIMIT $1
        `, [limit]);
        
        res.json({ data: result.rows });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get recent activity');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// POST /api/v1/dashboard/trigger-sync - Manual sync trigger
// ============================================================
router.post('/trigger-sync', async (req: Request, res: Response) => {
    const { type = 'hourly' } = req.body;
    
    try {
        const scheduler = await import('../../scheduler/sync-scheduler');
        
        if (type === 'priority') {
            await scheduler.triggerPrioritySync();
        } else {
            await scheduler.triggerHourlySync();
        }
        
        res.json({ message: `${type} sync triggered` });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to trigger sync');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
