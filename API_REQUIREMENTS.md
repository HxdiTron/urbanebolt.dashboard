# UrbaneBolt Dashboard — API Requirements

This document outlines the API endpoints required for the logistics dashboard, organized by module.

---

## 1. Shipments Module

### GET `/api/shipments`
Fetch shipments with optional filters.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pickup_date` | `YYYY-MM-DD` | No | Filter by pickup date |
| `shipment_type` | `COD` \| `PPD` | No | Filter by shipment type |
| `status` | `string` | No | Filter by status code (DEL, INT, OFD, RTO, etc.) |
| `awb` | `string` | No | Search by AWB number (exact or partial) |
| `limit` | `number` | No | Max rows to return (default: 500) |
| `cursor` | `string` | No | Pagination cursor for next page |

**Response Fields:**
```json
{
  "data": [
    {
      "awbNumber": "string",
      "order_number": "string",
      "customerName": "string",
      "customerCode": "string",
      "origin": "string",
      "originPincode": "string",
      "destination": "string",
      "destinationPincode": "string",
      "collectable_value": "number",
      "declared_value": "number",
      "serviceType": "string",
      "product_type": "string",
      "statusCode": "string",
      "statusDescription": "string",
      "edd": "date",
      "riderName": "string",
      "attemptCount": "number",
      "pickup_date": "date",
      "last_status_date": "date",
      "created_at": "timestamp",
      "updated_at": "timestamp",
      "first_udReason": "string",
      "last_udReason": "string"
    }
  ],
  "nextCursor": "string | null",
  "total": "number"
}
```

### GET `/api/shipments/:awb`
Fetch a single shipment by AWB number.

**Response:** Single shipment object (same fields as above).

---

## 2. KPIs / Performance Module

### GET `/api/kpis`
Fetch aggregated performance metrics.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pickup_date` | `YYYY-MM-DD` | No | Filter by pickup date |
| `shipment_type` | `COD` \| `PPD` | No | Filter by shipment type |

**Response:**
```json
{
  "total_shipments": "number",
  "delivered": "number",
  "in_transit": "number",
  "exceptions": "number",
  "cancelled": "number",
  "delivery_success_rate": "number (percentage)",
  "avg_tat_hours": "number",
  "cod_collected": "number (INR)",
  "cod_outstanding": "number (INR)",
  "amount_earned": "number (INR)"
}
```

---

## 3. COD Reconciliation Module

### GET `/api/cod`
Fetch COD shipments for reconciliation.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pickup_date` | `YYYY-MM-DD` | No | Filter by pickup date |
| `status` | `collected` \| `outstanding` | No | Filter by collection status |
| `limit` | `number` | No | Max rows |
| `cursor` | `string` | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "awbNumber": "string",
      "customerName": "string",
      "collectable_value": "number",
      "statusCode": "string",
      "statusDescription": "string",
      "riderName": "string",
      "pickup_date": "date",
      "last_status_date": "date"
    }
  ],
  "summary": {
    "total_cod_shipments": "number",
    "collected_amount": "number",
    "outstanding_amount": "number"
  },
  "nextCursor": "string | null"
}
```

### GET `/api/cod/export`
Download COD data as CSV.

**Query Parameters:** Same as `/api/cod`

**Response:** `text/csv` file download.

---

## 4. Exceptions / RTO / NDR Module

### GET `/api/exceptions`
Fetch exception shipments (UD, RTO, NDR, Failed).

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pickup_date` | `YYYY-MM-DD` | No | Filter by pickup date |
| `shipment_type` | `COD` \| `PPD` | No | Filter by shipment type |
| `exception_type` | `UD` \| `RTO` \| `NDR` | No | Filter by exception type |
| `limit` | `number` | No | Max rows |
| `cursor` | `string` | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "awbNumber": "string",
      "customerName": "string",
      "origin": "string",
      "destination": "string",
      "statusCode": "string",
      "statusDescription": "string",
      "first_udReason": "string",
      "last_udReason": "string",
      "attemptCount": "number",
      "riderName": "string",
      "pickup_date": "date",
      "last_status_date": "date",
      "aging_days": "number"
    }
  ],
  "summary": {
    "total_exceptions": "number",
    "ud_count": "number",
    "rto_count": "number",
    "ndr_count": "number"
  },
  "nextCursor": "string | null"
}
```

---

## 5. Riders Module

### GET `/api/riders`
Fetch rider performance summary.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pickup_date` | `YYYY-MM-DD` | No | Filter by pickup date |

**Response:**
```json
{
  "data": [
    {
      "riderName": "string",
      "riderId": "string",
      "total_assigned": "number",
      "delivered": "number",
      "in_progress": "number",
      "exceptions": "number",
      "cancelled": "number",
      "delivery_rate": "number (percentage)"
    }
  ]
}
```

---

## 6. Status Codes Reference

| Code | Description | Category |
|------|-------------|----------|
| `DEL` | Delivered | Delivered |
| `INT` | In Transit | In Progress |
| `OFD` | Out for Delivery | In Progress |
| `OFD1` | Out for Delivery (Attempt 1) | In Progress |
| `OFD2` | Out for Delivery (Attempt 2) | In Progress |
| `UD` | Undelivered | Exception |
| `RTO` | Return to Origin | Exception |
| `NDR` | Non-Delivery Report | Exception |
| `CNL` | Cancelled | Cancelled |
| `CAN` | Cancelled | Cancelled |

---

## Authentication

All endpoints should support:
- **API Key**: `X-API-Key` header
- **Bearer Token**: `Authorization: Bearer <token>` header

---

## Notes for Backend Team

1. **Performance**: For 100k+ rows, implement server-side pagination (cursor-based recommended).
2. **Caching**: KPI endpoints can be cached for 30-60 seconds.
3. **Rate Limiting**: Suggested 100 requests/minute per client.
4. **CORS**: Enable for dashboard domain(s).

---

## Current Dashboard URL

**Production**: _(to be updated after deployment)_

---

*Document Version: 1.0*  
*Last Updated: January 2026*
