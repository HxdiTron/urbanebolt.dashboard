# UrbaneBolt Tracking Backend

Production-ready backend system for polling the UrbaneBolt tracking API.

## Features

- **Rate Limiting**: Max 60 requests/minute with distributed Redis counter
- **Concurrency Control**: Hard limit of 20 concurrent API requests
- **Circuit Breaker**: Automatic failure isolation and recovery
- **Smart Scheduling**: Status-based sync intervals (delivered=24h, OFD=30min)
- **Change Detection**: Hash-based deduplication to skip unchanged data
- **Horizontal Scaling**: Multiple workers sharing global limits
- **Full Observability**: Prometheus metrics, Grafana dashboards, structured logs

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  API Server │     │  Scheduler  │     │   Workers   │
│   (Express) │     │  (Cron)     │     │  (BullMQ)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
              ┌────────────┴────────────┐
              │    Redis (Queue/Cache)   │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │   PostgreSQL (Storage)   │
              └─────────────────────────┘
```

## Quick Start

### Using Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Scale workers
docker-compose up -d --scale worker=5

# Stop all services
docker-compose down
```

### Manual Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your settings

# Initialize database
npm run db:init

# Start development
npm run dev

# Or start individual services
npm run dev:api       # API server only
npm run dev:worker    # Worker only
npm run dev:scheduler # Scheduler only
```

## API Endpoints

### Shipments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/shipments` | List shipments (paginated) |
| GET | `/api/v1/shipments/:awb` | Get single shipment |
| POST | `/api/v1/shipments/batch` | Get multiple shipments |
| POST | `/api/v1/shipments/add` | Add AWBs to tracking |
| POST | `/api/v1/shipments/sync` | Force sync specific AWBs |
| DELETE | `/api/v1/shipments/:awb` | Remove from tracking |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard/stats` | Aggregate statistics |
| GET | `/api/v1/dashboard/status-breakdown` | Status distribution |
| GET | `/api/v1/dashboard/sync-status` | Sync system health |
| GET | `/api/v1/dashboard/recent-activity` | Recent sync logs |
| POST | `/api/v1/dashboard/trigger-sync` | Manual sync trigger |

### Health & Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3000` | API server port |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Logging level |
| `MAX_CONCURRENT_REQUESTS` | `20` | Max concurrent API calls |
| `REQUESTS_PER_MINUTE` | `60` | Rate limit |
| `REQUEST_TIMEOUT` | `30000` | API timeout (ms) |

## Scaling for 100k+ Shipments

With the following constraints:
- Max 20 concurrent requests
- ~500ms average API response time
- 60 req/min rate limit

**Calculations:**
- Throughput: ~40 req/second (theoretical max)
- With smart scheduling (skip ~60% unchanged): ~17 minutes for 100k
- Recommended: 3-5 worker instances

## Monitoring

Access monitoring tools:
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin123)

Key metrics:
- `tracking_sync_total` - Total sync attempts by status
- `tracking_api_latency_seconds` - API response latency
- `tracking_concurrent_requests` - Current concurrent calls
- `tracking_circuit_breaker_open` - Circuit breaker state

## License

Proprietary - UrbaneBolt
