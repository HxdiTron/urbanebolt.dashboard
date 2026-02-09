import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { healthCheck as dbHealthCheck } from '../db';
import { registry, httpRequestDuration, httpRequestTotal } from '../utils/metrics';
import shipmentsRouter from './routes/shipments';
import dashboardRouter from './routes/dashboard';

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging & metrics
app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
        const duration = (Date.now() - startTime) / 1000;
        const route = req.route?.path || req.path;
        
        httpRequestDuration.observe(
            { method: req.method, route, status_code: res.statusCode.toString() },
            duration
        );
        httpRequestTotal.inc(
            { method: req.method, route, status_code: res.statusCode.toString() }
        );
        
        logger.info({
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - startTime,
        }, 'Request completed');
    });
    
    next();
});

// ============================================================
// ROUTES
// ============================================================

// Health check
app.get('/health', async (req: Request, res: Response) => {
    const dbOk = await dbHealthCheck();
    
    res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
            database: dbOk ? 'ok' : 'error',
        },
    });
});

// Prometheus metrics
app.get('/metrics', async (req: Request, res: Response) => {
    try {
        res.set('Content-Type', registry.contentType);
        res.end(await registry.metrics());
    } catch (error) {
        res.status(500).end();
    }
});

// API routes
app.use('/api/v1/shipments', shipmentsRouter);
app.use('/api/v1/dashboard', dashboardRouter);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// SERVER START
// ============================================================
const server = app.listen(CONFIG.PORT, () => {
    logger.info({ port: CONFIG.PORT }, 'API server started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

export default app;
