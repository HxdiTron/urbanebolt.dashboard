/**
 * Example server wiring: Express + MongoDB + upload + dashboard summary.
 * Alternative entry: npx ts-node-dev src/server.ts
 * Uses: MONGODB_URI, MONGODB_DB, PORT from env.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { CONFIG } from './config';
import { connectDB, ensureShipmentIndexes } from './lib/mongo';
import uploadRouter from './routes/upload';
import dashboardRouter from './routes/dashboard';
import { logger } from './utils/logger';

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/dashboard', dashboardRouter);

app.get('/health', async (_req: Request, res: Response) => {
    try {
        await connectDB();
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err instanceof Error ? err.message : String(err) });
    }
});

app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

async function start() {
    try {
        await connectDB();
        await ensureShipmentIndexes();
        const port = CONFIG.PORT;
        app.listen(port, () => {
            logger.info({ port }, 'Server started (Mongo + upload + dashboard)');
        });
    } catch (err) {
        logger.error({ err }, 'Failed to start server');
        process.exit(1);
    }
}

start();
