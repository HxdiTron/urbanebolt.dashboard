/**
 * POST /api/v1/upload - Excel upload, parse, transform, bulkWrite to MongoDB.
 * Chunked bulkWrite (5000 rows), upsert by AWB. Production-ready for 200k rows.
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { connectDB, ensureShipmentIndexes } from '../lib/mongo';
import { invalidateDashboardCache } from '../lib/dashboard-cache';
import {
    buildHeaderMap,
    transformRow,
    ShipmentDocument,
} from '../lib/transform';
import { logger } from '../utils/logger';

const router = Router();

const multerStorage = multer.memoryStorage();
const upload = multer({
    storage: multerStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
});

const CHUNK_SIZE = 5000;

router.post('/', (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (err) {
            logger.warn({ err }, 'Multer upload error');
            res.status(400).json({
                error: 'File upload failed',
                detail: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        next();
    });
}, async (req: Request, res: Response) => {
    if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file".' });
        return;
    }

    const batchId = uuidv4();
    const uploadedAt = new Date();

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            res.status(400).json({ error: 'Excel file has no sheets' });
            return;
        }
        const sheet = workbook.Sheets[firstSheetName];
        const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            raw: false,
        });
        if (!data.length) {
            res.status(400).json({ error: 'Sheet is empty' });
            return;
        }

        const rawHeaders = (data[0] as string[]).map((h) => (h != null ? String(h) : ''));
        const headerMap = buildHeaderMap(rawHeaders);
        const rows = data.slice(1) as unknown[][];

        const documents: ShipmentDocument[] = [];
        for (let i = 0; i < rows.length; i++) {
            try {
                const doc = transformRow(rows[i], headerMap, batchId, uploadedAt, rawHeaders);
                if (doc) documents.push(doc);
            } catch (err) {
                logger.warn({ rowIndex: i + 2, err }, 'Transform row skipped');
            }
        }

        const totalRows = documents.length;
        if (totalRows === 0) {
            res.status(400).json({
                error: 'No valid rows (each row must have an AWB)',
                totalRows: rows.length,
            });
            return;
        }

        const db = await connectDB();
        await ensureShipmentIndexes();
        const coll = db.collection<ShipmentDocument>('shipments');

        let insertedCount = 0;
        let modifiedCount = 0;

        for (let start = 0; start < documents.length; start += CHUNK_SIZE) {
            const chunk = documents.slice(start, start + CHUNK_SIZE);
            const ops = chunk.map((doc) => ({
                updateOne: {
                    filter: { awb: doc.awb },
                    update: { $set: doc },
                    upsert: true,
                },
            }));
            const result = await coll.bulkWrite(ops);
            insertedCount += result.upsertedCount ?? 0;
            modifiedCount += result.modifiedCount ?? 0;
        }

        invalidateDashboardCache();

        res.json({
            totalRows,
            insertedCount,
            modifiedCount,
            batchId,
        });
    } catch (err) {
        logger.error({ err, batchId }, 'Upload failed');
        res.status(500).json({
            error: 'Upload failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }
});

export default router;
