/**
 * GET /api/v1/dashboard/summary - Mongo aggregation for dashboard KPIs.
 */

import { Router, Request, Response } from 'express';
import { connectDB } from '../lib/mongo';
import { logger } from '../utils/logger';

const router = Router();

router.get('/summary', async (req: Request, res: Response) => {
    try {
        const db = await connectDB();
        const coll = db.collection('shipments');

        const pipeline = [
            {
                $facet: {
                    totals: [
                        { $count: 'totalShipments' },
                    ],
                    breaches: [
                        { $match: { slaBreach: true } },
                        {
                            $group: {
                                _id: '$slaStatus',
                                count: { $sum: 1 },
                            },
                        },
                    ],
                    openBreach: [
                        { $match: { slaStatus: 'OPEN_BREACH' } },
                        { $count: 'count' },
                    ],
                    onTime: [
                        { $match: { slaStatus: 'ON_TIME' } },
                        { $count: 'count' },
                    ],
                    delivered: [
                        { $match: { deliveredOn: { $ne: null } } },
                        { $count: 'count' },
                    ],
                    revenueAtRisk: [
                        {
                            $match: {
                                slaStatus: { $in: ['OPEN_BREACH', 'IN_PROGRESS'] },
                                agingDays: { $gt: 3 },
                            },
                        },
                        { $group: { _id: null, sum: { $sum: '$invoiceValue' } } },
                    ],
                    rto: [
                        { $match: { isRTO: true } },
                        { $count: 'count' },
                    ],
                    rtoRevenue: [
                        { $match: { isRTO: true } },
                        { $group: { _id: null, sum: { $sum: '$invoiceValue' } } },
                    ],
                },
            },
        ];

        const [result] = await coll.aggregate(pipeline).toArray();
        if (!result) {
            return res.json({
                totalShipments: 0,
                breachCount: 0,
                openBreachCount: 0,
                slaPercentage: 0,
                revenueAtRisk: 0,
                rtoPercentage: 0,
            });
        }

        const totalShipments = result.totals?.[0]?.totalShipments ?? 0;
        const breachCount = (result.breaches || []).reduce((s: number, b: { count: number }) => s + b.count, 0);
        const openBreachCount = result.openBreach?.[0]?.count ?? 0;
        const onTimeCount = result.onTime?.[0]?.count ?? 0;
        const deliveredCount = result.delivered?.[0]?.count ?? 0;
        const slaPercentage = deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 1000) / 10 : 0;
        const revenueAtRisk = result.revenueAtRisk?.[0]?.sum ?? 0;
        const rtoCount = result.rto?.[0]?.count ?? 0;
        const rtoPercentage = totalShipments > 0 ? Math.round((rtoCount / totalShipments) * 1000) / 10 : 0;

        res.json({
            totalShipments,
            breachCount,
            openBreachCount,
            slaPercentage,
            revenueAtRisk,
            rtoPercentage,
        });
    } catch (err) {
        logger.error({ err }, 'Dashboard summary failed');
        res.status(500).json({
            error: 'Dashboard summary failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

export default router;
