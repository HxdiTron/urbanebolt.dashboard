# Module 1: Shipments API

**Status:** ✅ Complete  
**Deployed:** https://urbanebolt-dashboard.vercel.app/api/shipments  
**Last Updated:** January 2026

---

## Overview

REST API for shipment data management — supports listing, searching, creating, updating, and deleting shipment records.

---

## Authentication

All endpoints require one of:

| Method | Header | Usage |
|--------|--------|-------|
| **API Key** | `X-API-Key: <key>` | Machine-to-machine / ERP integration |
| **JWT Token** | `Authorization: Bearer <token>` | User sessions |

---

## Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shipments` | List shipments with filters & pagination |
| `POST` | `/api/shipments` | Create new shipment |
| `GET` | `/api/shipments/{awb}` | Get single shipment by AWB |
| `PATCH` | `/api/shipments/{awb}` | Update shipment |
| `DELETE` | `/api/shipments/{awb}` | Delete shipment (admin only) |

---

## 1. List Shipments

```
GET /api/shipments
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `pickup_date` | `YYYY-MM-DD` | Filter by pickup date |
| `shipment_type` | `COD` / `PPD` | Filter by payment type |
| `status` | `string` | Filter by status code (DEL, INT, OFD, RTO, etc.) |
| `awb` | `string` | Search by AWB number (partial match) |
| `limit` | `1-1000` | Results per page (default: 100) |
| `offset` | `number` | Skip N results |
| `sort_by` | `created_at` / `pickup_date` / `awbNumber` | Sort field |
| `sort_order` | `asc` / `desc` | Sort direction |

### Example Request

```bash
curl -X GET "https://urbanebolt-dashboard.vercel.app/api/shipments?pickup_date=2026-01-23&shipment_type=COD&limit=50" \
  -H "X-API-Key: YOUR_API_KEY"
```

### Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "awbNumber": "AWB123456789",
      "order_number": "ORD-2026-001",
      "customerName": "Acme Corp",
      "origin": "Mumbai",
      "destination": "Delhi",
      "collectable_value": 1500,
      "declared_value": 2000,
      "statusCode": "INT",
      "statusDescription": "In Transit",
      "riderName": "Raj Kumar",
      "pickup_date": "2026-01-20",
      "last_status_date": "2026-01-21"
    }
  ],
  "pagination": {
    "total": 1234,
    "limit": 50,
    "offset": 0,
    "hasMore": true,
    "nextCursor": "eyJ2YWx1ZSI6..."
  }
}
```

---

## 2. Get Single Shipment

```
GET /api/shipments/{awb}
```

### Example

```bash
curl -X GET "https://urbanebolt-dashboard.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 3. Create Shipment

```
POST /api/shipments
```

### Request Body

```json
{
  "awbNumber": "AWB999888777",
  "order_number": "ORD-2026-100",
  "customerName": "Tech Solutions",
  "origin": "Bangalore",
  "originPincode": "560001",
  "destination": "Chennai",
  "destinationPincode": "600001",
  "collectable_value": 2500,
  "declared_value": 3000,
  "serviceType": "Standard",
  "statusCode": "NEW"
}
```

### Example

```bash
curl -X POST "https://urbanebolt-dashboard.vercel.app/api/shipments" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"awbNumber":"AWB999888777","customerName":"Tech Solutions","collectable_value":2500}'
```

---

## 4. Update Shipment

```
PATCH /api/shipments/{awb}
```

### Example (Update Status)

```bash
curl -X PATCH "https://urbanebolt-dashboard.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"statusCode":"DEL","statusDescription":"Delivered"}'
```

---

## 5. Delete Shipment

```
DELETE /api/shipments/{awb}
```

> **Note:** Requires admin role or API key.

```bash
curl -X DELETE "https://urbanebolt-dashboard.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Validation failed",
    "details": ["awbNumber is required"]
  }
}
```

| Code | Description |
|------|-------------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict (already exists) |
| 500 | Internal Error |

---

## Status Codes Reference

| Code | Description | Category |
|------|-------------|----------|
| `NEW` | Newly created | New |
| `PKD` | Picked up | In Progress |
| `INT` | In Transit | In Progress |
| `OFD` | Out for Delivery | In Progress |
| `DEL` | Delivered | Delivered |
| `UD` | Undelivered | Exception |
| `RTO` | Return to Origin | Exception |
| `NDR` | Non-Delivery Report | Exception |
| `CNL` | Cancelled | Cancelled |

---

## Environment Variables Required

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
API_KEY=your-secure-api-key
```

---

## Next Modules (Pending)

- [ ] Module 2: KPIs / Performance API
- [ ] Module 3: COD Reconciliation API
- [ ] Module 4: Exceptions / RTO / NDR API
- [ ] Module 5: Riders API

---

*Document Version: 1.0*
