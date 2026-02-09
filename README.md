# UrbaneBolt Dashboard

Logistics operations dashboard for shipment tracking, COD reconciliation, and performance monitoring.

## Pages

| Page | Description |
|------|-------------|
| `index.html` | Main dashboard with KPIs, charts, and shipment table |
| `cod.html` | COD reconciliation with CSV export |
| `exceptions.html` | RTO & exceptions view |
| `riders.html` | Rider performance |
| `manifest.html` | Master manifest |
| `shipment.html` | Single shipment detail |

## Setup

1. Copy `assets/config.example.js` to `assets/config.js`
2. Add your Supabase credentials:
   ```js
   window.SUPABASE_URL = "https://your-project.supabase.co";
   window.SUPABASE_ANON_KEY = "your-anon-key";
   ```

## Deploy to Vercel

1. Push to GitHub
2. Import to Vercel
3. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

## Tech Stack

- HTML + Tailwind CSS
- Vanilla JavaScript
- Supabase (database)
