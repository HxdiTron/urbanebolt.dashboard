/**
 * UrbaneBolt Tracking Backend - Main Entry Point
 * 
 * This file can start all services or individual services based on
 * the SERVICE environment variable:
 *   - SERVICE=api    -> Start API server only
 *   - SERVICE=worker -> Start sync worker only
 *   - SERVICE=scheduler -> Start scheduler only
 *   - SERVICE=all (default) -> Start all services
 */

import { CONFIG } from './config';
import { logger } from './utils/logger';
import { closePool } from './db';
import { closeQueue } from './queue/tracking-queue';

const SERVICE = process.env.SERVICE || 'all';

async function startServices() {
    logger.info({ service: SERVICE, env: CONFIG.NODE_ENV }, 'Starting UrbaneBolt Tracking Backend');
    
    try {
        if (SERVICE === 'api' || SERVICE === 'all') {
            await import('./api/index');
            logger.info('API server started');
        }
        
        const redisEnabled = Boolean(CONFIG.REDIS_URL && CONFIG.REDIS_URL.trim());
        if (SERVICE === 'worker' || SERVICE === 'all') {
            if (redisEnabled) {
                await import('./workers/tracking-worker');
                logger.info('Sync worker started');
            } else {
                logger.info('Sync worker skipped (Redis not configured)');
            }
        }
        
        if (SERVICE === 'scheduler' || SERVICE === 'all') {
            if (redisEnabled) {
                const scheduler = await import('./scheduler/sync-scheduler');
                scheduler.startScheduler();
                logger.info('Scheduler started');
            } else {
                logger.info('Scheduler skipped (Redis not configured)');
            }
        }
        
        logger.info('All services started successfully');
        
    } catch (error) {
        logger.error({ error }, 'Failed to start services');
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown() {
    logger.info('Shutting down...');
    
    try {
        await closeQueue();
        await closePool();
        logger.info('Cleanup complete');
        process.exit(0);
    } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
    }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
startServices();
