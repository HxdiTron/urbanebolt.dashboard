# UrbaneBolt Operations Dashboard

Production-grade logistics dashboard with secure API integration.

## Security Features

| Feature | Implementation |
|---------|----------------|
| **Rate Limiting** | Max 60 requests/minute, enforced client-side |
| **Concurrent Limit** | Max 20 simultaneous requests (hard limit) |
| **Circuit Breaker** | Stops requests after 5 consecutive failures |
| **Request Deduplication** | Prevents duplicate in-flight requests |
| **Throttling** | Minimum 100ms between requests |
| **Timeout** | 30-second timeout with abort |
| **Retry** | Automatic retry with exponential backoff |
| **Input Sanitization** | AWB inputs stripped to alphanumeric only |
| **XSS Protection** | All dynamic content HTML-escaped |

## Setup

### Excel upload & MongoDB dashboard (recommended for local use)

1. **Start the backend** (serves the API and the dashboard):

   ```bash
   cd backend
   npm install
   # Set MONGODB_URI (and optionally MONGODB_DB) in .env
   npm run dev:api
   ```

2. **Open the app from the same origin** as the API, e.g.  
   **http://localhost:3000** (or the port your backend uses).  
   The dashboard will use this URL automatically on localhost, so:
   - **Upload to MongoDB** and **Load from server** work (no 404/405).

If you open `index.html` from the file system or another host, set the API URL in `config.js` or override with `localStorage.setItem('urbanebolt_api_base', 'http://localhost:3000')`.

**Redis is optional.** If you don't set `REDIS_URL` in `backend/.env`, the API runs without Redis (no connection errors). Queue/sync are disabled until you set `REDIS_URL`.

### Quick check (run and verify)

1. **Start the API** (from project root):
   ```bash
   cd backend && npm run build && npm run dev:api
   ```
   You should see: `Redis not configured ...`, `API server started`, `port: 3000`, and `MongoDB connected` (if `MONGODB_URI` is in `.env`). No Redis connection errors.

2. **Open in browser:** **http://localhost:3000**
   - Dashboard loads; KPIs may show 0 until you load data.
   - **Import Excel** or **Load from server** to load shipments from MongoDB.
   - Click an AWB to open **Shipment detail** (tracking history, Proof of Delivery, SLA).
   - POD images: put files in `delivery_pods/` (e.g. `delivery_pods/WDJ/2026/01/03/xxx.png`) or set `DELIVERY_PODS_PATH` in `.env`.

3. **Optional:** Use Live Server (e.g. port 5500) for `index.html`; the app will still call the API at `http://localhost:3000` (see `config.js`).

### Optional: config.js override

Override the API base URL (e.g. for a separate production API):

```javascript
localStorage.setItem('urbanebolt_api_base', 'https://api.urbanebolt.in');
```

When deployed to Vercel, the app uses the same origin for API calls automatically.

## Deploy to Vercel

1. **Push the repo to GitHub** (if not already).

2. **Import the project in Vercel**  
   [vercel.com](https://vercel.com) → Add New Project → Import your repo.

3. **Set environment variables** in Vercel project settings:
   - `MONGODB_URI` – MongoDB connection string (e.g. MongoDB Atlas)
   - `MONGODB_DB` – database name (default: `urbanebolt`)
   - `API_BASE_URL` – external tracking API URL (default: `https://api.urbanebolt.in`)
   - `DATABASE_URL` – Postgres connection string (optional; for queue stats/sync features)
   - `REDIS_URL` – leave empty unless using queue/sync
   - `DELIVERY_PODS_PATH` – optional; path to POD images (serverless has ephemeral storage)

4. **Deploy**  
   Vercel runs `cd backend && npm install && npm run build` and serves the app.  
   API routes (`/api/*`, `/health`, `/metrics`) are handled by the serverless function.

5. **Limitations on Vercel**
   - POD images in `delivery_pods/` are not persisted (serverless storage is ephemeral). Use a cloud storage URL or external CDN for POD images.
   - Redis/Postgres are optional; dashboard and Excel upload work with MongoDB only.

## API Endpoints Used

```
GET /api/v1/services/tracking/?awb={awb_number}
```

## Files

| File | Purpose |
|------|---------|
| `api.js` | Secure API client with rate limiting |
| `config.js` | Your API configuration (gitignored) |
| `index.html` | Main dashboard with search & filters |
| `shipment.html` | Single shipment detail view |
| `manifest.html` | Master manifest |
| `riders.html` | Rider allocation |
| `cod.html` | COD reconciliation |
| `exceptions.html` | RTO & exceptions |

## Rate Limiting Details

The dashboard enforces strict rate limits to protect your API:

1. **Client-Side Limits**
   - 60 requests max per minute
   - 20 concurrent requests max
   - 100ms minimum between requests
   - Requests queue automatically when limits hit

2. **Circuit Breaker**
   - Opens after 5 consecutive failures
   - Auto-resets after 30 seconds
   - All queued requests rejected when open

3. **Visual Indicators**
   - Green: < 50% of rate limit used
   - Amber: 50-80% of rate limit used
   - Red: > 80% or circuit breaker open

## Production scalability (100k+ shipments)

The dashboard uses **server-side cursor pagination** so it works on Vercel (10–60s serverless timeout) and with large MongoDB collections:

- **Backend** (`GET /api/v1/dashboard/shipments`): Returns one page (default 100, max 500) per request. Uses `?limit=&after=` (cursor). Optional `includeTotal=1` returns approximate total via `estimatedDocumentCount` (max 3s). Response is limited to needed fields (projection) and `maxTimeMS(8000)` keeps the query within platform limits.
- **Frontend**: "Load from server" loads the first page only. "Next page" / "Prev page" fetch the next cursor or show the previous cached page. No single request loads the full collection.
- **MongoDB**: List query uses `sort({ _id: -1 })` and cursor `_id: { $lt: afterId }`; `_id` is indexed by default. Ensure indexes from `ensureShipmentIndexes()` (awb, bookingDate, customer, etc.) for other queries.
- **Trade-offs**: Filters (status, origin, etc.) apply only to the current page. For collection-wide filters you’d add server-side filter query params later. Summary KPIs come from the cached `/summary` endpoint (aggregation), not from the list response.

## Production Deployment

For production, consider:

1. **Backend Proxy** - Hide your actual API endpoint
2. **Server-side Rate Limiting** - Additional protection
3. **Authentication** - Add login if needed
4. **HTTPS** - Always use SSL

## Tech Stack

- HTML5 + TailwindCSS (CDN in dev; for production use [Tailwind CLI or PostCSS](https://tailwindcss.com/docs/installation))
- Vanilla JavaScript (no frontend build required)
- No frontend dependencies to install
