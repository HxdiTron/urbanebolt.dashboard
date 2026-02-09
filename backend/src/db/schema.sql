-- ============================================================
-- UrbaneBolt Tracking Backend Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SHIPMENTS TABLE (Main entity)
-- ============================================================
CREATE TABLE IF NOT EXISTS shipments (
    id              BIGSERIAL PRIMARY KEY,
    awb             VARCHAR(50) NOT NULL UNIQUE,
    
    -- Tracking State
    status_code     VARCHAR(20),
    status_desc     VARCHAR(255),
    current_location VARCHAR(100),
    
    -- Shipment Details (cached from API)
    shipper_name    VARCHAR(255),
    origin          VARCHAR(100),
    destination     VARCHAR(100),
    product_type    VARCHAR(10),  -- PPD/COD
    weight          DECIMAL(10,2),
    is_rto          BOOLEAN DEFAULT FALSE,
    
    -- Raw API response (JSONB for flexibility)
    raw_data        JSONB,
    
    -- Change Detection
    data_hash       VARCHAR(64),  -- SHA256 of raw_data for deduplication
    
    -- Sync Metadata
    last_synced_at  TIMESTAMPTZ,
    next_sync_at    TIMESTAMPTZ,
    sync_priority   SMALLINT DEFAULT 5,  -- 1=highest, 10=lowest
    sync_failures   SMALLINT DEFAULT 0,
    last_error      TEXT,
    
    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_priority CHECK (sync_priority BETWEEN 1 AND 10)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status_code);
CREATE INDEX IF NOT EXISTS idx_shipments_next_sync ON shipments(next_sync_at) WHERE next_sync_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_priority ON shipments(sync_priority, next_sync_at);
CREATE INDEX IF NOT EXISTS idx_shipments_updated ON shipments(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_product_type ON shipments(product_type);

-- ============================================================
-- SYNC_BATCHES TABLE (Job tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_batches (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
    
    -- Batch Info
    total_awbs      INTEGER NOT NULL,
    processed       INTEGER DEFAULT 0,
    succeeded       INTEGER DEFAULT 0,
    failed          INTEGER DEFAULT 0,
    skipped         INTEGER DEFAULT 0,  -- Skipped due to no changes
    
    -- Status
    status          VARCHAR(20) DEFAULT 'pending',  -- pending, running, completed, failed
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    
    -- Metrics
    api_calls_made  INTEGER DEFAULT 0,
    avg_response_ms INTEGER,
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_batches_status ON sync_batches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_batches_batch_id ON sync_batches(batch_id);

-- ============================================================
-- SYNC_LOGS TABLE (Detailed audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_logs (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        UUID REFERENCES sync_batches(batch_id) ON DELETE SET NULL,
    awb             VARCHAR(50) NOT NULL,
    
    -- Result
    success         BOOLEAN NOT NULL,
    changed         BOOLEAN,  -- TRUE if data actually changed
    error_code      VARCHAR(50),
    error_message   TEXT,
    
    -- Performance
    response_time_ms INTEGER,
    retry_count     SMALLINT DEFAULT 0,
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_batch ON sync_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_awb ON sync_logs(awb, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created ON sync_logs(created_at);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_shipments_updated ON shipments;
CREATE TRIGGER trg_shipments_updated
    BEFORE UPDATE ON shipments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Calculate next sync time based on status
CREATE OR REPLACE FUNCTION calculate_next_sync(
    p_status_code VARCHAR,
    p_sync_failures SMALLINT
) RETURNS TIMESTAMPTZ AS $$
DECLARE
    base_interval INTERVAL;
    backoff_multiplier INTEGER;
BEGIN
    -- Base interval by status (cost optimization)
    CASE p_status_code
        WHEN 'DDL' THEN base_interval := INTERVAL '24 hours';  -- Delivered: sync daily
        WHEN 'RTO' THEN base_interval := INTERVAL '12 hours';  -- RTO: sync every 12h
        WHEN 'CAN' THEN base_interval := INTERVAL '24 hours';  -- Cancelled: sync daily
        WHEN 'OFD' THEN base_interval := INTERVAL '30 minutes'; -- Out for delivery: frequent
        WHEN 'DDS' THEN base_interval := INTERVAL '30 minutes'; -- Delivery scheduled: frequent
        WHEN 'UDD' THEN base_interval := INTERVAL '2 hours';   -- Undelivered: check often
        ELSE base_interval := INTERVAL '1 hour';               -- Default: hourly
    END CASE;
    
    -- Exponential backoff for failures (max 24h)
    IF p_sync_failures > 0 THEN
        backoff_multiplier := LEAST(POWER(2, p_sync_failures)::INTEGER, 24);
        base_interval := base_interval * backoff_multiplier;
    END IF;
    
    RETURN NOW() + base_interval;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VIEWS (for dashboard queries)
-- ============================================================

CREATE OR REPLACE VIEW shipment_stats AS
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status_code = 'DDL') as delivered,
    COUNT(*) FILTER (WHERE status_code IN ('OFD', 'DDS')) as out_for_delivery,
    COUNT(*) FILTER (WHERE status_code IN ('MAN','PKD','IND','BGD','DPD','ARD','RDC','DBG')) as in_transit,
    COUNT(*) FILTER (WHERE status_code = 'RTO' OR is_rto = true) as rto,
    COUNT(*) FILTER (WHERE status_code = 'UDD') as undelivered,
    COUNT(*) FILTER (WHERE status_code = 'CAN') as cancelled,
    COUNT(*) FILTER (WHERE product_type = 'COD') as cod_count,
    COUNT(*) FILTER (WHERE product_type = 'PPD') as ppd_count,
    MAX(last_synced_at) as last_sync,
    AVG(EXTRACT(EPOCH FROM (NOW() - last_synced_at))) as avg_data_age_seconds
FROM shipments;

-- ============================================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================================

-- Uncomment to add test data:
-- INSERT INTO shipments (awb, status_code, status_desc, origin, destination, product_type, next_sync_at)
-- VALUES 
--     ('200000077431', 'DDL', 'Delivered', 'Bengaluru', 'Bengaluru', 'PPD', NOW()),
--     ('200000077432', 'OFD', 'Out for Delivery', 'Mumbai', 'Pune', 'COD', NOW()),
--     ('200000077433', 'INTRANSIT', 'In Transit', 'Delhi', 'Chennai', 'PPD', NOW());
