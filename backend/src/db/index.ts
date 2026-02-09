import { Pool, PoolClient, QueryResult } from 'pg';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

// Create connection pool
const pool = new Pool({
    connectionString: CONFIG.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Log pool events
pool.on('connect', () => {
    logger.debug('Database pool: new client connected');
});

pool.on('error', (err) => {
    logger.error({ err }, 'Database pool error');
});

// Query helper with logging
export async function query<T = any>(
    text: string,
    params?: any[]
): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
        const result = await pool.query<T>(text, params);
        const duration = Date.now() - start;
        logger.debug({ query: text.substring(0, 100), duration, rows: result.rowCount }, 'DB query executed');
        return result;
    } catch (error) {
        logger.error({ query: text.substring(0, 100), error }, 'DB query failed');
        throw error;
    }
}

// Get client for transactions
export async function getClient(): Promise<PoolClient> {
    const client = await pool.connect();
    return client;
}

// Health check
export async function healthCheck(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

// Close pool
export async function closePool(): Promise<void> {
    await pool.end();
    logger.info('Database pool closed');
}

export { pool };
export default { query, getClient, healthCheck, closePool, pool };
