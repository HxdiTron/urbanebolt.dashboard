import { Router, Request, Response } from 'express';
import { query } from '../../db';
import { logger } from '../../utils/logger';
import { trackingQueue } from '../../queue/tracking-queue';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ============================================================
// GET /api/v1/shipments/:awb - Get single shipment
// ============================================================
router.get('/:awb', async (req: Request, res: Response) => {
    const { awb } = req.params;
    
    try {
        const result = await query(
            'SELECT * FROM shipments WHERE awb = $1',
            [awb]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipment not found' });
        }
        
        res.json({ data: result.rows[0] });
        
    } catch (error: any) {
        logger.error({ awb, error: error.message }, 'Failed to get shipment');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// POST /api/v1/shipments/batch - Get multiple shipments
// ============================================================
router.post('/batch', async (req: Request, res: Response) => {
    const { awbs } = req.body;
    
    if (!Array.isArray(awbs) || awbs.length === 0) {
        return res.status(400).json({ error: 'awbs array required' });
    }
    
    if (awbs.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 AWBs per request' });
    }
    
    try {
        const result = await query(
            'SELECT * FROM shipments WHERE awb = ANY($1)',
            [awbs]
        );
        
        res.json({
            data: result.rows,
            found: result.rows.length,
            requested: awbs.length,
        });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get batch');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// GET /api/v1/shipments - List with pagination
// ============================================================
router.get('/', async (req: Request, res: Response) => {
    const {
        page = '1',
        limit = '50',
        status,
        type,
        sort = 'updated_at',
        order = 'desc',
    } = req.query;
    
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;
    
    try {
        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (status) {
            whereClause += ` AND status_code = $${paramIndex++}`;
            params.push(status);
        }
        if (type) {
            whereClause += ` AND product_type = $${paramIndex++}`;
            params.push(type);
        }
        
        const validSorts = ['updated_at', 'created_at', 'awb', 'status_code', 'last_synced_at'];
        const sortCol = validSorts.includes(sort as string) ? sort : 'updated_at';
        const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
        
        const countResult = await query(
            `SELECT COUNT(*) FROM shipments ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);
        
        const result = await query(
            `SELECT * FROM shipments ${whereClause}
             ORDER BY ${sortCol} ${sortOrder}
             LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
            [...params, limitNum, offset]
        );
        
        res.json({
            data: result.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to list shipments');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// POST /api/v1/shipments/sync - Force sync specific AWBs
// ============================================================
router.post('/sync', async (req: Request, res: Response) => {
    const { awbs } = req.body;
    
    if (!Array.isArray(awbs) || awbs.length === 0 || awbs.length > 20) {
        return res.status(400).json({ error: 'Provide 1-20 AWBs' });
    }
    
    try {
        const batchId = uuidv4();
        const job = await trackingQueue.add('manual-sync', {
            type: 'priority',
            awbs,
            batchId,
            reason: 'manual_trigger',
        }, { priority: 1 });
        
        res.json({
            message: 'Sync job enqueued',
            jobId: job.id,
            batchId,
            awbCount: awbs.length,
        });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to enqueue sync');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// POST /api/v1/shipments/add - Add AWBs to tracking
// ============================================================
router.post('/add', async (req: Request, res: Response) => {
    const { awbs } = req.body;
    
    if (!Array.isArray(awbs) || awbs.length === 0 || awbs.length > 100) {
        return res.status(400).json({ error: 'Provide 1-100 AWBs' });
    }
    
    try {
        // Insert AWBs with immediate sync scheduled
        const values = awbs.map((awb, i) => `($${i + 1}, NOW())`).join(', ');
        await query(
            `INSERT INTO shipments (awb, next_sync_at) 
             VALUES ${values}
             ON CONFLICT (awb) DO UPDATE SET next_sync_at = NOW()`,
            awbs
        );
        
        // Trigger immediate sync
        const batchId = uuidv4();
        await trackingQueue.add('add-sync', {
            type: 'priority',
            awbs,
            batchId,
            reason: 'new_awbs_added',
        }, { priority: 1 });
        
        res.json({
            message: 'AWBs added and sync enqueued',
            awbCount: awbs.length,
            batchId,
        });
        
    } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to add AWBs');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// DELETE /api/v1/shipments/:awb - Remove AWB from tracking
// ============================================================
router.delete('/:awb', async (req: Request, res: Response) => {
    const { awb } = req.params;
    
    try {
        const result = await query(
            'DELETE FROM shipments WHERE awb = $1 RETURNING awb',
            [awb]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Shipment not found' });
        }
        
        res.json({ message: 'Shipment removed', awb });
        
    } catch (error: any) {
        logger.error({ awb, error: error.message }, 'Failed to delete shipment');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
