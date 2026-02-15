import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { healthCheck as dbHealthCheck } from '../db';
import { mongoHealthCheck } from '../lib/mongo';
import { registry, httpRequestDuration, httpRequestTotal } from '../utils/metrics';
import dashboardRouter from './routes/dashboard';
import uploadRouter from '../routes/upload';

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.get('/health', async (req: Request, res: Response) => {
    const dbOk = await dbHealthCheck();
    res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: { database: dbOk ? 'ok' : 'error' },
    });
});

/** Connection status for Postgres and MongoDB - use this to verify both are reachable */
app.get('/api/v1/connections', async (req: Request, res: Response) => {
    const [postgres, mongo] = await Promise.all([
        dbHealthCheck().then((ok) => ({ ok, error: ok ? undefined : 'Connection failed' })),
        mongoHealthCheck(),
    ]);
    const allOk = postgres.ok && mongo.ok;
    res.status(allOk ? 200 : 503).json({
        timestamp: new Date().toISOString(),
        postgres: { ok: postgres.ok, error: postgres.error },
        mongo: { ok: mongo.ok, error: mongo.error },
        allConnected: allOk,
    });
});

app.get('/metrics', async (req: Request, res: Response) => {
    try {
        res.set('Content-Type', registry.contentType);
        res.end(await registry.metrics());
    } catch {
        res.status(500).end();
    }
});

// Allow CORS preflight for upload (some proxies need explicit OPTIONS)
app.options('/api/v1/upload', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
});
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/upload', uploadRouter);

/** Proxy tracking to external API so the frontend can use localhost and still get tracking data */
app.get('/api/v1/services/tracking/', async (req: Request, res: Response) => {
    const awb = (req.query.awb as string)?.trim();
    if (!awb) {
        res.status(400).json({ status: 'Error', error: 'Missing awb query parameter' });
        return;
    }
    const url = `${CONFIG.API_BASE_URL}/api/v1/services/tracking/?awb=${encodeURIComponent(awb)}`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
        const proxyRes = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await proxyRes.json();
        res.status(proxyRes.status).json(data);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Proxy request failed';
        logger.warn({ err, url }, 'Tracking proxy error');
        res.status(502).json({ status: 'Error', error: message });
    }
});

const staticRoot = path.join(__dirname, '../../../');
// Serve POD images at /delivery_pods from DELIVERY_PODS_PATH or project root /delivery_pods
const deliveryPodsDir = CONFIG.DELIVERY_PODS_PATH
    ? path.resolve(CONFIG.DELIVERY_PODS_PATH)
    : path.join(staticRoot, 'delivery_pods');
if (fs.existsSync(deliveryPodsDir)) {
    app.use('/delivery_pods', express.static(deliveryPodsDir, { maxAge: '1d' }));
    logger.info({ path: deliveryPodsDir }, 'Serving delivery PODs at /delivery_pods');
} else {
    logger.warn({ path: deliveryPodsDir }, 'Delivery PODs directory not found; set DELIVERY_PODS_PATH or create delivery_pods/');
}

app.use(express.static(staticRoot));
app.get('/', (_, res) => res.sendFile(path.join(staticRoot, 'index.html')));
app.get('/analytics.html', (_, res) => res.sendFile(path.join(staticRoot, 'analytics.html')));

app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

export default app;

// Start HTTP server only when not running on Vercel (serverless)
if (process.env.VERCEL !== '1') {
    const server = app.listen(CONFIG.PORT, async () => {
        logger.info({ port: CONFIG.PORT }, 'API server started');
        mongoHealthCheck()
            .then((r) => {
                if (r.ok) logger.info('MongoDB connection check: OK');
                else logger.warn({ error: r.error }, 'MongoDB connection check: FAILED');
            })
            .catch((e) => logger.warn({ err: e }, 'MongoDB connection check: FAILED'));
    });
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received, shutting down...');
        server.close(() => { logger.info('Server closed'); process.exit(0); });
    });
    process.on('SIGINT', () => {
        logger.info('SIGINT received, shutting down...');
        server.close(() => { logger.info('Server closed'); process.exit(0); });
    });
}
