import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { query } from '../../db';
import { logger } from '../../utils/logger';
import { rateLimiter, concurrencyLimiter, circuitBreaker, trackingQueue } from '../../queue/tracking-queue';
import { connectDB } from '../../lib/mongo';
import { getCachedSummary, setCachedSummary } from '../../lib/dashboard-cache';

const router = Router();

function toSafeDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const d = { ...doc };
    delete d._id;
    ['bookingDate', 'edd', 'deliveredOn', 'uploadedAt'].forEach((k) => {
        const v = d[k];
        if (v instanceof Date && !Number.isNaN(v.getTime())) d[k] = v.toISOString();
        else if (v != null && typeof v === 'string') d[k] = v;
    });
    return d;
}

// ============================================================
// GET /api/v1/dashboard/shipments/:awb - Single shipment by AWB (MongoDB)
// ============================================================
router.get('/shipments/:awb', async (req: Request, res: Response) => {
    const awb = (req.params.awb || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!awb) {
        return res.status(400).json({ error: 'AWB required' });
    }
    try {
        const db = await connectDB();
        const doc = await db.collection('shipments').findOne({ awb });
        if (!doc) {
            return res.status(404).json({ error: 'Shipment not found', awb });
        }
        const d = toSafeDoc(doc as Record<string, unknown>);
        return res.json(d);
    } catch (err: unknown) {
        logger.error({ err, awb }, 'Get shipment by AWB failed');
        return res.status(500).json({
            error: 'Get shipment failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ============================================================
// GET /api/v1/dashboard/shipments - List shipments (cursor)
// Use ?after=ObjectIdHex for cursor-based pagination (no large skip).
// ============================================================
router.get('/shipments', async (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(200000, Math.max(1, Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10000));
    const after = typeof req.query.after === 'string' && req.query.after.trim() ? req.query.after.trim() : null;
    try {
        const db = await connectDB();
        const coll = db.collection('shipments');
        let cursor;
        if (after) {
            try {
                const afterId = new ObjectId(after);
                cursor = coll.find({ _id: { $lt: afterId } }).sort({ _id: -1 }).limit(limit);
            } catch {
                return res.status(400).json({ error: 'Invalid after cursor' });
            }
        } else {
            cursor = coll.find({}).sort({ _id: -1 }).limit(limit);
        }
        const shipments = await cursor.toArray();
        const total = after ? 0 : await coll.countDocuments({});
        const list = shipments.map((doc: Record<string, unknown>) => toSafeDoc(doc));
        const last = shipments[shipments.length - 1];
        const nextAfter = last && last._id ? String((last as { _id: ObjectId })._id) : null;
        res.json({
            shipments: list,
            ...(total >= 0 && !after ? { total } : {}),
            ...(nextAfter ? { nextAfter } : {}),
        });
    } catch (err: unknown) {
        logger.error({ err, limit, after: after ? 'yes' : 'no' }, 'List shipments failed');
        res.status(500).json({
            error: 'List shipments failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ============================================================
// GET /api/v1/dashboard/summary - Mongo aggregation (Excel uploads)
// 60s in-memory cache; invalidated after upload so never stale post-batch.
// ============================================================
router.get('/summary', async (req: Request, res: Response) => {
    try {
        const cached = getCachedSummary();
        if (cached) {
            return res.json(cached);
        }

        const db = await connectDB();
        const coll = db.collection('shipments');
        const pipeline = [
            {
                $facet: {
                    totals: [{ $count: 'totalShipments' }],
                    breaches: [{ $match: { slaBreach: true } }, { $count: 'count' }],
                    openBreach: [{ $match: { slaStatus: 'OPEN_BREACH' } }, { $count: 'count' }],
                    onTime: [{ $match: { slaStatus: 'ON_TIME' } }, { $count: 'count' }],
                    delivered: [{ $match: { deliveredOn: { $ne: null } } }, { $count: 'count' }],
                    revenueAtRisk: [
                        { $match: { slaStatus: { $in: ['OPEN_BREACH', 'IN_PROGRESS'] }, agingDays: { $gt: 3 } } },
                        { $group: { _id: null, sum: { $sum: '$invoiceValue' } } },
                    ],
                    rto: [{ $match: { isRTO: true } }, { $count: 'count' }],
                },
            },
        ];
        const [result] = await coll.aggregate(pipeline).toArray();
        const totalShipments = result?.totals?.[0]?.totalShipments ?? 0;
        const breachCount = result?.breaches?.[0]?.count ?? 0;
        const openBreachCount = result?.openBreach?.[0]?.count ?? 0;
        const onTimeCount = result?.onTime?.[0]?.count ?? 0;
        const deliveredCount = result?.delivered?.[0]?.count ?? 0;
        const slaPercentage = deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 1000) / 10 : 0;
        const revenueAtRisk = result?.revenueAtRisk?.[0]?.sum ?? 0;
        const rtoCount = result?.rto?.[0]?.count ?? 0;
        const rtoPercentage = totalShipments > 0 ? Math.round((rtoCount / totalShipments) * 1000) / 10 : 0;

        const summary = {
            totalShipments,
            breachCount,
            openBreachCount,
            slaPercentage,
            revenueAtRisk,
            rtoPercentage,
        };
        setCachedSummary(summary);
        res.json(summary);
    } catch (err: unknown) {
        logger.error({ err }, 'Dashboard summary failed');
        res.status(500).json({
            error: 'Dashboard summary failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ============================================================
// GET /api/v1/dashboard/stats - Dashboard aggregates (Postgres)
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
