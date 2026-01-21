# urbaneBolt.dashboard

Operations dashboard for logistics performance tracking (COD, exceptions/RTO/NDR, rider performance, shipment mix), designed for **high-volume** datasets and **near-real-time** refresh.

This repo currently ships as a **static HTML dashboard** (no build step) with a thin data layer. For production scale (**100k+ rows** changing **every minute**), the recommended approach is: **static UI + backend data API** (server-side) + **pagination/aggregation** + **incremental updates**.

---

## 1) Requirements (what the dashboard must do)

### Functional requirements
- **Shipment performance view by day**
  - Date selection (Pickup Date) and filters (Shipment Type: **PPD / COD**).
  - Performance definition: compare **Pickup Date vs Last Status Date** (TAT / aging).
- **Current status storytelling**
  - Status mix: Delivered / In Progress / Cancelled / Exceptions (UD/RTO/NDR).
  - Color-based grading (badges + row stripe) for instant scanning.
- **COD reconciliation**
  - COD totals (delivered vs outstanding) derived from live shipment data.
  - **Downloadable CSV** export for the filtered COD dataset.
- **RTO & Exceptions**
  - UD/RTO/NDR queues with reasons, rider, route, aging.
- **Rider performance**
  - Per-rider totals and category split (Delivered / In Progress / Exceptions / Cancelled).
- **Master manifest view**
  - Latest shipment records with key fields.

### Non-functional requirements
- **Scale**
  - Dataset: **100,000+ rows**.
  - Update cadence: **~every 60 seconds** (or streaming events).
- **Speed**
  - Time-to-interactive for dashboard shell: **< 2s** (CDN + static assets).
  - Data refresh: **incremental** (avoid full dataset reloads).
- **Reliability**
  - Graceful empty/error states when upstream is unavailable.
  - Observable (logs/metrics) and debuggable.
- **Security**
  - Never expose ERP API keys in the browser.
  - Follow least-privilege access; use server-side secrets.

---

## 2) Recommended production architecture for 100k+ rows (minute updates)

### Why not “fetch all rows to the browser”
Pulling 100k+ rows into a client table every minute is expensive, slow, and fragile:
- Large payloads (bandwidth + memory).
- Slow rendering (DOM cost).
- Overloads upstream DB/API.

### Target architecture (high-level)
- **Frontend (this repo)**: static site on CDN (Cloudflare/Vercel/Netlify/S3+CloudFront).
- **Backend API (required for scale)**:
  - A serverless function or small service that talks to ERP/DB with secrets.
  - Provides **paginated**, **filtered**, **aggregated** endpoints.
- **Data store** (recommended):
  - Mirror/warehouse tables for analytics (Postgres/BigQuery/ClickHouse).
  - Materialized views / rollups for daily performance KPIs.

### API contract (suggested)
Instead of returning “all shipments”, the backend should provide:
- `GET /api/shipments?pickupDate=YYYY-MM-DD&type=COD|PPD&status=...&cursor=...&limit=...`
- `GET /api/kpis?pickupDate=YYYY-MM-DD&type=COD|PPD`
  - returns totals + status mix + avg/median TAT + rider aggregates.
- `GET /api/exceptions?pickupDate=YYYY-MM-DD&type=COD|PPD&cursor=...`
- `GET /api/cod/export?pickupDate=YYYY-MM-DD&type=COD|PPD` → CSV stream

### Update strategy (every minute)
Choose one:
- **Polling (simple & reliable)**: refresh KPIs every 60s + refresh visible table page only.
- **Incremental polling (best)**: `since=<lastSeenStatusTime>` to fetch deltas.
- **SSE/WebSocket (real-time)**: push updates; keep UI reactive.

### UI performance techniques
- **Server-side pagination** (cursor-based) instead of rendering 100k rows at once.
- **Virtualized table** (render only visible rows) if you must show large lists.
- **Derived metrics on backend** (status mix, COD totals, rider KPIs) to reduce client CPU.
- **Cache + CDN** for KPI endpoints (short TTL like 10–30s).

---

## 3) Current implementation in this repo (what exists today)

### Frontend stack
- **HTML + TailwindCSS (CDN)** for UI.
- **Vanilla JavaScript** for rendering + interactions.
- **Supabase JS (optional)** for data access during prototyping.
- Small shared utilities in `assets/data.js` (caching, filtering, helpers).

### Live pages
- `index.html`: dashboard overview (filters + KPIs + live table)
- `cod.html`: COD reconciliation + CSV download
- `exceptions.html`: UD/RTO/NDR view
- `riders.html`: rider summary
- `manifest.html`: master manifest list
- `shipment.html`: shipment detail

---

## 4) Deployment (production-grade)

### Static hosting
Host the repo as a static site:
- Cloudflare Pages / Vercel Static / Netlify / S3+CloudFront

### Environment configuration (no secrets in repo)
This dashboard reads runtime config from `assets/config.js` (gitignored).

1) Copy:
- `assets/config.example.js` → `assets/config.js`

2) Set:
- `window.SUPABASE_URL`
- `window.SUPABASE_ANON_KEY`

> For true production scale (ERP API), replace direct browser-to-data calls with a server-side API proxy and keep ERP keys in server environment variables.

### Observability & ops
Recommended for production:
- Request logs for `/api/*` endpoints
- Error reporting (Sentry/Datadog)
- Basic KPIs: latency, error rate, cache hit rate

---

## 5) Profile + stack details (for leadership update)

### Profile (editable)
- **Name**: Hadi Shafat (update if needed)
- **Role**: Dashboard / Ops Analytics Engineering
- **Focus**: Operational visibility, SLA performance, COD reconciliation, exception management

### Stack & skills
- **Frontend**: HTML, TailwindCSS, JavaScript (performance-first UI, data visualization)
- **Backend (recommended for ERP integration)**: Node.js serverless/API proxy, REST/SSE/WebSocket
- **Data**: Postgres/Supabase (prototyping), server-side rollups/materialized views for scale
- **Deployment**: CDN-hosted static UI + serverless APIs, env-based secret management

---

## Notes / security
- Do **not** commit `.env.local`, `assets/config.js`, or any ERP keys.
- If Supabase RLS blocks reads (or anon reads are disabled), the UI shows empty/error states.