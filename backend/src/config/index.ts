import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
    // Database
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://urbanebolt:localdev123@localhost:5432/urbanebolt',
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    MONGODB_DB: process.env.MONGODB_DB || 'urbanebolt',
    
    // Redis (optional: leave unset or set REDIS_DISABLED=1 to run without Redis; queue/sync will be disabled)
    REDIS_URL: process.env.REDIS_DISABLED ? '' : (process.env.REDIS_URL || ''),
    
    // API Server
    PORT: parseInt(process.env.PORT || '3000'),
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Proof of Delivery images: directory to serve at /delivery_pods (can be absolute path)
    DELIVERY_PODS_PATH: process.env.DELIVERY_PODS_PATH || '',
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    
    // Third-Party API Configuration
    API_BASE_URL: process.env.API_BASE_URL || 'https://api.urbanebolt.in',
    
    // API Constraints
    MAX_CONCURRENT_REQUESTS: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '20'),
    REQUESTS_PER_MINUTE: parseInt(process.env.REQUESTS_PER_MINUTE || '60'),
    BATCH_SIZE: 20,
    
    // Retry Configuration
    MAX_RETRIES: 3,
    INITIAL_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 60000,
    BACKOFF_MULTIPLIER: 2,
    
    // Timeouts
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
    JOB_TIMEOUT: 300000,
    
    // Scheduling
    SYNC_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
    
    // Circuit Breaker
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_RESET_TIMEOUT: 30000,
    
    // Cache
    CACHE_TTL: 300, // 5 minutes
};

export default CONFIG;
