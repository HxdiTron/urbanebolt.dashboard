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

1. Create `config.js` with your API settings:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    API.configure({
        baseUrl: 'https://api.urbanebolt.in',
        maxBatchSize: 20,  // Max 20, cannot exceed
    });
});
```

2. Open `index.html` in browser

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

## Production Deployment

For production, consider:

1. **Backend Proxy** - Hide your actual API endpoint
2. **Server-side Rate Limiting** - Additional protection
3. **Authentication** - Add login if needed
4. **HTTPS** - Always use SSL

## Tech Stack

- HTML5 + TailwindCSS (CDN)
- Vanilla JavaScript (no build required)
- No dependencies to install
