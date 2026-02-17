import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import https from 'https';
import http from 'http';
import { query } from '../../db';
import { logger } from '../../utils/logger';
import { rateLimiter, concurrencyLimiter, circuitBreaker, trackingQueue } from '../../queue/tracking-queue';
import { connectDB } from '../../lib/mongo';
import { getCachedSummary, setCachedSummary } from '../../lib/dashboard-cache';

const router = Router();
const POD_PROXY_TIMEOUT_MS = 15000;

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
// Production: small pages, projection, no count in hot path, maxTimeMS.
// Use ?limit=100&after=ObjectIdHex. includeTotal=1 for approximate total (slow).
// ============================================================
const LIST_PROJECTION = {
    _id: 1,
    awb: 1,
    customer: 1,
    origin: 1,
    destination: 1,
    bookingDate: 1,
    edd: 1,
    deliveredOn: 1,
    status: 1,
    invoiceValue: 1,
    weight: 1,
    pieces: 1,
    isRTO: 1,
    slaStatus: 1,
    slaBreach: 1,
    deliveryTAT: 1,
    agingDays: 1,
    uploadedAt: 1,
    delPod: 1,
    orderNumber: 1,
};
const MAX_TIME_MS = 8000;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

router.get('/shipments', async (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
        MAX_PAGE_LIMIT,
        Math.max(1, Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE_LIMIT)
    );
    const after = typeof req.query.after === 'string' && req.query.after.trim() ? req.query.after.trim() : null;
    const includeTotal = req.query.includeTotal === '1' || req.query.includeTotal === 'true';
    try {
        const db = await connectDB();
        const coll = db.collection('shipments');
        let cursor;
        if (after) {
            try {
                const afterId = new ObjectId(after);
                cursor = coll
                    .find({ _id: { $lt: afterId } })
                    .sort({ _id: -1 })
                    .limit(limit)
                    .project(LIST_PROJECTION)
                    .maxTimeMS(MAX_TIME_MS);
            } catch {
                return res.status(400).json({ error: 'Invalid after cursor' });
            }
        } else {
            cursor = coll
                .find({})
                .sort({ _id: -1 })
                .limit(limit)
                .project(LIST_PROJECTION)
                .maxTimeMS(MAX_TIME_MS);
        }
        const shipments = await cursor.toArray();
        let total: number | undefined;
        if (includeTotal && !after) {
            try {
                total = await coll.estimatedDocumentCount({ maxTimeMS: 3000 });
            } catch {
                total = undefined;
            }
        }
        const list = shipments.map((doc: Record<string, unknown>) => toSafeDoc(doc));
        const last = shipments[shipments.length - 1];
        const nextAfter = last && last._id ? String((last as { _id: ObjectId })._id) : null;
        res.json({
            shipments: list,
            ...(total !== undefined ? { total } : {}),
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
        const inTransitCount = Math.max(0, totalShipments - deliveredCount - rtoCount);

        const summary = {
            totalShipments,
            deliveredCount,
            rtoCount,
            inTransitCount,
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
// GET /api/v1/dashboard/pod - Proxy POD image so it loads in UI (avoids CORS / mixed content)
// ============================================================
router.get('/pod', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
        return res.status(400).json({ error: 'Invalid or missing url (must be http or https)' });
    }
    try {
        const u = new URL(rawUrl);
        if (['localhost', '127.0.0.1'].includes(u.hostname.toLowerCase())) {
            return res.status(400).json({ error: 'POD proxy does not allow localhost' });
        }
        const lib = u.protocol === 'https:' ? https : http;
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
            const clientReq = lib.get(rawUrl, { timeout: POD_PROXY_TIMEOUT_MS }, (response) => {
                if (response.statusCode && response.statusCode >= 400) {
                    reject(new Error(`Upstream returned ${response.statusCode}`));
                    return;
                }
                const ct = response.headers['content-type'] || 'image/jpeg';
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    res.setHeader('Content-Type', ct);
                    res.setHeader('Cache-Control', 'private, max-age=86400');
                    res.send(Buffer.concat(chunks));
                    resolve();
                });
                response.on('error', reject);
            });
            clientReq.on('error', reject);
            clientReq.on('timeout', () => { clientReq.destroy(); reject(new Error('Timeout')); });
        });
    } catch (err: unknown) {
        logger.warn({ err, url: rawUrl }, 'POD proxy failed');
        res.status(502).json({
            error: 'Could not load POD image',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

// ============================================================
// GET /api/v1/dashboard/insights - Full-DB chart data (Mongo)
// Same shape as frontend computeInsights() so charts use all data, not current page.
// ============================================================
const INSIGHTS_MAX_TIME_MS = 20000;

router.get('/insights', async (req: Request, res: Response) => {
    try {
        const db = await connectDB();
        const coll = db.collection('shipments');

        const delayedMatch = { $or: [ { slaStatus: 'OPEN_BREACH' }, { slaBreach: true } ] };
        const rtoMatch = { $or: [ { isRTO: true }, { status: { $in: ['RTO', 'RTD', 'rto', 'rtd'] } } ] };

        const pipeline: Record<string, unknown>[] = [
            {
                $facet: {
                    topDelayedCustomers: [
                        { $match: delayedMatch },
                        { $group: { _id: { $ifNull: ['$customer', 'N/A'] }, count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 5 },
                        { $project: { name: '$_id', count: 1, _id: 0 } },
                    ],
                    rtoByCustomer: [
                        { $group: { _id: { $ifNull: ['$customer', 'N/A'] }, total: { $sum: 1 }, rto: { $sum: { $cond: [{ $or: [{ $eq: ['$isRTO', true] }, { $in: [{ $toUpper: { $ifNull: ['$status', ''] } }, ['RTO', 'RTD']] }] }, 1, 0] } } } },
                        { $match: { total: { $gte: 3 } } },
                        { $addFields: { pct: { $cond: [{ $eq: ['$total', 0] }, '0', { $toString: { $round: [{ $multiply: [{ $divide: ['$rto', '$total'] }, 100] }, 1] } }] } } },
                        { $sort: { pct: -1 } },
                        { $limit: 5 },
                        { $project: { name: '$_id', total: 1, rto: 1, pct: 1, _id: 0 } },
                    ],
                    statusDistribution: [
                        { $group: { _id: { $ifNull: [{ $toUpper: { $trim: { input: '$status' } } }, 'UNKNOWN'] }, count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $project: { code: '$_id', count: 1, _id: 0 } },
                    ],
                    topReasons: [
                        { $match: { $or: [delayedMatch, rtoMatch] } },
                        { $group: { _id: { $ifNull: [{ $trim: { input: { $toString: '$reasonCode' } } }, { $ifNull: [{ $trim: { input: { $toString: '$reasonDescription' } } }, 'Unknown'] }] }, count: { $sum: 1 } } },
                        { $match: { _id: { $ne: '' } } },
                        { $sort: { count: -1 } },
                        { $limit: 5 },
                        { $project: { reason: '$_id', count: 1, _id: 0 } },
                    ],
                    worstOrigins: [
                        { $match: delayedMatch },
                        { $group: { _id: { $ifNull: ['$origin', 'N/A'] }, count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 3 },
                        { $project: { hub: '$_id', count: 1, _id: 0 } },
                    ],
                    worstDestinations: [
                        { $match: delayedMatch },
                        { $group: { _id: { $ifNull: ['$destination', 'N/A'] }, count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 3 },
                        { $project: { hub: '$_id', count: 1, _id: 0 } },
                    ],
                    dayDistribution: [
                        {
                            $addFields: {
                                _activityDate: {
                                    $cond: {
                                        if: { $ne: ['$lastUpdateTime', null] },
                                        then: { $toDate: '$lastUpdateTime' },
                                        else: { $cond: { if: { $ne: ['$uploadedAt', null] }, then: '$uploadedAt', else: '$bookingDate' } },
                                    },
                                },
                            },
                        },
                        { $match: { _activityDate: { $type: 'date' } } },
                        { $group: { _id: { $dayOfWeek: '$_activityDate' }, count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                        { $project: { dayOfWeek: '$_id', count: 1, _id: 0 } },
                    ],
                    regionalPerformance: [
                        {
                            $group: {
                                _id: { $ifNull: ['$destination', 'N/A'] },
                                total: { $sum: 1 },
                                delivered: { $sum: { $cond: [{ $ne: ['$deliveredOn', null] }, 1, 0] } },
                                onTime: { $sum: { $cond: [{ $and: [{ $ne: ['$deliveredOn', null] }, { $ne: ['$slaBreach', true] }] }, 1, 0] } },
                                rto: { $sum: { $cond: [{ $or: [{ $eq: ['$isRTO', true] }, { $in: [{ $toUpper: { $ifNull: ['$status', ''] } }, ['RTO', 'RTD']] }] }, 1, 0] } },
                            },
                        },
                        { $match: { total: { $gte: 10 } } },
                        {
                            $project: {
                                region: '$_id',
                                total: 1,
                                onTimePct: { $cond: [{ $eq: ['$delivered', 0] }, '0', { $toString: { $round: [{ $multiply: [{ $divide: ['$onTime', '$delivered'] }, 100] }, 1] } }] },
                                rtoPct: { $cond: [{ $eq: ['$total', 0] }, '0', { $toString: { $round: [{ $multiply: [{ $divide: ['$rto', '$total'] }, 100] }, 1] } }] },
                                _id: 0,
                            },
                        },
                        { $sort: { onTimePct: -1 } },
                        { $limit: 10 },
                    ],
                    avgTat: [
                        { $match: { deliveredOn: { $ne: null }, deliveryTAT: { $ne: null, $type: 'number' } } },
                        { $group: { _id: null, avg: { $avg: '$deliveryTAT' } } },
                        { $project: { _id: 0 } },
                    ],
                },
            },
        ];

        const [result] = await coll.aggregate(pipeline).maxTimeMS(INSIGHTS_MAX_TIME_MS).toArray();
        const facet = (result?.topDelayedCustomers != null ? result : {}) as Record<string, unknown>;

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const rawDayDist = (facet.dayDistribution as { dayOfWeek?: number; count?: number }[]) || [];
        const dayMap: Record<number, number> = {};
        rawDayDist.forEach((d) => { dayMap[d.dayOfWeek ?? 0] = d.count ?? 0; });
        const dayDistribution = dayNames.map((day, i) => ({ day, count: dayMap[i + 1] ?? 0 }));

        const regionalPerformance = ((facet.regionalPerformance as { region?: string; total?: number; onTimePct?: string; rtoPct?: string }[]) || []).map((r) => ({
            region: r.region ?? 'N/A',
            total: r.total ?? 0,
            onTimePct: String(r.onTimePct ?? '0'),
            rtoPct: String(r.rtoPct ?? '0'),
        }));

        const topDelayedCustomers = ((facet.topDelayedCustomers as { name?: string; count?: number }[]) || []).map((c) => ({ name: c.name ?? 'N/A', count: c.count ?? 0, pct: '0' }));
        const rtoByCustomer = ((facet.rtoByCustomer as { name?: string; total?: number; rto?: number; pct?: string }[]) || []).map((c) => ({ name: c.name ?? 'N/A', total: c.total ?? 0, rto: c.rto ?? 0, pct: String(c.pct ?? '0') }));
        const statusDistribution = ((facet.statusDistribution as { code?: string; count?: number }[]) || []).map((s) => ({ code: s.code ?? 'Unknown', count: s.count ?? 0, pct: '0' }));
        const topReasons = (facet.topReasons as { reason?: string; count?: number }[]) || [];
        const worstOrigins = ((facet.worstOrigins as { hub?: string; count?: number }[]) || []).map((h) => [h.hub ?? 'N/A', h.count ?? 0] as [string, number]);
        const worstDestinations = ((facet.worstDestinations as { hub?: string; count?: number }[]) || []).map((h) => [h.hub ?? 'N/A', h.count ?? 0] as [string, number]);
        const avgTatRow = (facet.avgTat as { avg?: number }[])?.[0];
        const avgTatDays = avgTatRow?.avg != null ? String(Number(avgTatRow.avg).toFixed(1)) : null;

        res.json({
            empty: false,
            fromApi: true,
            topDelayedCustomers,
            rtoByCustomer,
            statusDistribution,
            topReasons,
            worstOrigins,
            worstDestinations,
            dayDistribution,
            regionalPerformance,
            avgTatDays,
            avgPkdToOfdDays: null,
            avgOfdToDdlDays: null,
        });
    } catch (err: unknown) {
        logger.error({ err }, 'Dashboard insights failed');
        res.status(500).json({
            error: 'Insights failed',
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
