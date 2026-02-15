/**
 * MongoDB connection - singleton pattern.
 * Use MONGODB_URI from env. Export connectDB().
 */

import { MongoClient, Db } from 'mongodb';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

const MONGODB_URI = process.env.MONGODB_URI || CONFIG.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || CONFIG.MONGODB_DB || 'urbanebolt';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
    if (db) return db;
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        logger.info({ db: DB_NAME }, 'MongoDB connected');
        return db;
    } catch (err) {
        logger.error({ err, uri: MONGODB_URI.replace(/\/\/[^@]+@/, '//***@') }, 'MongoDB connection failed');
        throw err;
    }
}

export function getDb(): Db | null {
    return db;
}

export async function closeDB(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
        logger.info('MongoDB connection closed');
    }
}

/**
 * Check if MongoDB is reachable. Does not throw; returns status for health endpoints.
 */
export async function mongoHealthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
        const database = await connectDB();
        await database.command({ ping: 1 });
        return { ok: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    }
}

/**
 * Ensure indexes on shipments collection for production performance.
 */
export async function ensureShipmentIndexes(): Promise<void> {
    const database = await connectDB();
    const coll = database.collection('shipments');
    await coll.createIndex({ awb: 1 }, { unique: true });
    await coll.createIndex({ bookingDate: 1 });
    await coll.createIndex({ edd: 1 });
    await coll.createIndex({ customer: 1 });
    await coll.createIndex({ origin: 1, destination: 1 });
    await coll.createIndex({ slaBreach: 1 });
    logger.info('Shipment indexes ensured');
}
