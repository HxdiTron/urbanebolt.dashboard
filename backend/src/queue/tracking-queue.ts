import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

// ============================================================
// REDIS CONNECTION
// ============================================================
export const redisConnection = new Redis(CONFIG.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

redisConnection.on('connect', () => {
    logger.info('Redis connected');
});

redisConnection.on('error', (err) => {
    logger.error({ err }, 'Redis error');
});

// ============================================================
// JOB TYPES
// ============================================================
export interface SyncJobData {
    type: 'batch' | 'single' | 'priority';
    awbs: string[];
    batchId?: string;
    priority?: number;
    reason?: string;
}

// ============================================================
// TRACKING QUEUE
// ============================================================
export const trackingQueue = new Queue<SyncJobData>('tracking-sync', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: CONFIG.MAX_RETRIES,
        backoff: {
            type: 'exponential',
            delay: CONFIG.INITIAL_RETRY_DELAY,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
    },
});

// Queue events for monitoring
const queueEvents = new QueueEvents('tracking-sync', { connection: redisConnection });

queueEvents.on('completed', ({ jobId }) => {
    logger.debug({ jobId }, 'Job completed');
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error({ jobId, reason: failedReason }, 'Job failed');
});

// ============================================================
// DISTRIBUTED RATE LIMITER
// ============================================================
export class DistributedRateLimiter {
    private redis: Redis;
    private key: string;
    private maxRequests: number;
    private windowMs: number;

    constructor(redis: Redis, key: string, maxRequests: number, windowMs: number) {
        this.redis = redis;
        this.key = key;
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }

    async acquire(): Promise<boolean> {
        const now = Date.now();

        const script = `
            local key = KEYS[1]
            local now = tonumber(ARGV[1])
            local window = tonumber(ARGV[2])
            local limit = tonumber(ARGV[3])
            
            redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
            local count = redis.call('ZCARD', key)
            
            if count < limit then
                redis.call('ZADD', key, now, now .. '-' .. math.random())
                redis.call('EXPIRE', key, math.ceil(window / 1000))
                return 1
            else
                return 0
            end
        `;

        const result = await this.redis.eval(
            script, 1, this.key, now, this.windowMs, this.maxRequests
        );
        
        return result === 1;
    }

    async waitForSlot(maxWaitMs: number = 60000): Promise<boolean> {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            if (await this.acquire()) {
                return true;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return false;
    }

    async getUsage(): Promise<{ used: number; limit: number }> {
        const now = Date.now();
        await this.redis.zremrangebyscore(this.key, '-inf', now - this.windowMs);
        const used = await this.redis.zcard(this.key);
        return { used, limit: this.maxRequests };
    }
}

// ============================================================
// DISTRIBUTED SEMAPHORE (Concurrency Limiter)
// ============================================================
export class DistributedSemaphore {
    private redis: Redis;
    private key: string;
    private maxConcurrent: number;
    private ttlMs: number;

    constructor(redis: Redis, key: string, maxConcurrent: number, ttlMs: number = 60000) {
        this.redis = redis;
        this.key = key;
        this.maxConcurrent = maxConcurrent;
        this.ttlMs = ttlMs;
    }

    async acquire(requestId: string): Promise<boolean> {
        const script = `
            local key = KEYS[1]
            local requestId = ARGV[1]
            local maxConcurrent = tonumber(ARGV[2])
            local ttl = tonumber(ARGV[3])
            local now = tonumber(ARGV[4])
            
            redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)
            local count = redis.call('ZCARD', key)
            
            if count < maxConcurrent then
                redis.call('ZADD', key, now, requestId)
                return 1
            else
                return 0
            end
        `;

        const result = await this.redis.eval(
            script, 1, this.key, requestId, this.maxConcurrent, this.ttlMs, Date.now()
        );
        
        return result === 1;
    }

    async release(requestId: string): Promise<void> {
        await this.redis.zrem(this.key, requestId);
    }

    async getCurrent(): Promise<number> {
        await this.redis.zremrangebyscore(this.key, '-inf', Date.now() - this.ttlMs);
        return await this.redis.zcard(this.key);
    }
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================
export class CircuitBreaker {
    private redis: Redis;
    private key: string;
    private failureThreshold: number;
    private resetTimeout: number;
    
    constructor(redis: Redis, key: string, failureThreshold = 5, resetTimeout = 30000) {
        this.redis = redis;
        this.key = key;
        this.failureThreshold = failureThreshold;
        this.resetTimeout = resetTimeout;
    }

    async isOpen(): Promise<boolean> {
        const state = await this.redis.hgetall(this.key);
        if (!state.status) return false;
        
        if (state.status === 'open') {
            const openedAt = parseInt(state.openedAt || '0');
            if (Date.now() - openedAt > this.resetTimeout) {
                await this.halfOpen();
                return false;
            }
            return true;
        }
        return false;
    }

    async recordSuccess(): Promise<void> {
        await this.redis.hset(this.key, {
            status: 'closed',
            failures: '0',
            lastSuccess: Date.now().toString(),
        });
    }

    async recordFailure(): Promise<void> {
        const failures = await this.redis.hincrby(this.key, 'failures', 1);
        if (failures >= this.failureThreshold) {
            await this.redis.hset(this.key, {
                status: 'open',
                openedAt: Date.now().toString(),
            });
            logger.warn({ failures }, 'Circuit breaker opened');
        }
    }

    private async halfOpen(): Promise<void> {
        await this.redis.hset(this.key, 'status', 'half-open');
        logger.info('Circuit breaker half-open');
    }

    async getState(): Promise<{ status: string; failures: number }> {
        const state = await this.redis.hgetall(this.key);
        return {
            status: state.status || 'closed',
            failures: parseInt(state.failures || '0'),
        };
    }
}

// ============================================================
// GLOBAL INSTANCES
// ============================================================
export const rateLimiter = new DistributedRateLimiter(
    redisConnection,
    'api:ratelimit:tracking',
    CONFIG.REQUESTS_PER_MINUTE,
    60000
);

export const concurrencyLimiter = new DistributedSemaphore(
    redisConnection,
    'api:concurrent:tracking',
    CONFIG.MAX_CONCURRENT_REQUESTS,
    CONFIG.REQUEST_TIMEOUT + 5000
);

export const circuitBreaker = new CircuitBreaker(
    redisConnection,
    'api:circuit:tracking',
    CONFIG.CIRCUIT_BREAKER_THRESHOLD,
    CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT
);

// ============================================================
// CLEANUP
// ============================================================
export async function closeQueue(): Promise<void> {
    await trackingQueue.close();
    await queueEvents.close();
    redisConnection.disconnect();
    logger.info('Queue connections closed');
}
