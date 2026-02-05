# Shipments Module API

Production-ready REST API for shipment management.

## Base URL

```
Production: https://your-domain.vercel.app/api/shipments
Local:      http://localhost:3000/api/shipments
```

## Authentication

All endpoints require authentication via one of:

| Method | Header | Example |
|--------|--------|---------|
| API Key | `X-API-Key` | `X-API-Key: your-api-key` |
| JWT Token | `Authorization` | `Authorization: Bearer eyJhbG...` |

---

## Endpoints

### 1. List Shipments

```
GET /api/shipments
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pickup_date` | `YYYY-MM-DD` | - | Filter by pickup date |
| `shipment_type` | `COD` \| `PPD` | - | Filter by payment type |
| `status` | `string` | - | Filter by status code |
| `awb` | `string` | - | Search AWB (partial match) |
| `customer_code` | `string` | - | Filter by customer |
| `limit` | `1-1000` | `100` | Results per page |
| `offset` | `number` | `0` | Skip N results |
| `cursor` | `string` | - | Pagination cursor |
| `sort_by` | `created_at` \| `pickup_date` \| `awbNumber` | `created_at` | Sort field |
| `sort_order` | `asc` \| `desc` | `desc` | Sort direction |

**Example Request:**

```bash
# List all shipments
curl -X GET "https://your-domain.vercel.app/api/shipments" \
  -H "X-API-Key: your-api-key"

# Filter by date and type
curl -X GET "https://your-domain.vercel.app/api/shipments?pickup_date=2026-01-20&shipment_type=COD&limit=50" \
  -H "X-API-Key: your-api-key"

# Search by AWB
curl -X GET "https://your-domain.vercel.app/api/shipments?awb=AWB123" \
  -H "X-API-Key: your-api-key"
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "awbNumber": "AWB123456789",
      "order_number": "ORD-2026-001",
      "customerName": "Acme Corp",
      "customerCode": "ACME",
      "origin": "Mumbai",
      "originPincode": "400001",
      "destination": "Delhi",
      "destinationPincode": "110001",
      "collectable_value": 1500,
      "declared_value": 2000,
      "serviceType": "Express",
      "product_type": "Electronics",
      "statusCode": "INT",
      "statusDescription": "In Transit",
      "edd": "2026-01-25",
      "riderName": "Raj Kumar",
      "attemptCount": 0,
      "pickup_date": "2026-01-20",
      "last_status_date": "2026-01-21",
      "created_at": "2026-01-20T10:30:00Z",
      "updated_at": "2026-01-21T14:00:00Z"
    }
  ],
  "pagination": {
    "total": 1234,
    "limit": 100,
    "offset": 0,
    "hasMore": true,
    "nextCursor": "eyJ2YWx1ZSI6IjIwMjYtMDEtMjFUMTQ6MDA6MDBaIiwiaWQiOiJBV0IxMjM0NTY3ODkifQ=="
  }
}
```

---

### 2. Get Single Shipment

```
GET /api/shipments/:awb
```

**Example Request:**

```bash
curl -X GET "https://your-domain.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: your-api-key"
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "awbNumber": "AWB123456789",
    "order_number": "ORD-2026-001",
    "customerName": "Acme Corp",
    "statusCode": "DEL",
    "statusDescription": "Delivered",
    ...
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": {
    "code": 404,
    "message": "Shipment AWB123456789 not found"
  }
}
```

---

### 3. Create Shipment

```
POST /api/shipments
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `awbNumber` | `string` | Yes | Unique AWB number (5-50 chars) |
| `order_number` | `string` | No | Order reference |
| `customerName` | `string` | No | Customer name |
| `customerCode` | `string` | No | Customer code |
| `origin` | `string` | No | Origin city |
| `originPincode` | `string` | No | Origin pincode |
| `destination` | `string` | No | Destination city |
| `destinationPincode` | `string` | No | Destination pincode |
| `collectable_value` | `number` | No | COD amount (0 for prepaid) |
| `declared_value` | `number` | No | Declared value |
| `serviceType` | `string` | No | Service type |
| `product_type` | `string` | No | Product category |
| `statusCode` | `string` | No | Initial status (default: NEW) |
| `riderName` | `string` | No | Assigned rider |
| `pickup_date` | `string` | No | Pickup date |

**Example Request:**

```bash
curl -X POST "https://your-domain.vercel.app/api/shipments" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "awbNumber": "AWB999888777",
    "order_number": "ORD-2026-100",
    "customerName": "Tech Solutions",
    ...
    "created_at": "2026-01-23T10:30:00Z"
  }
}
```

**Response (409 Conflict):**

```json
{
  "success": false,
  "error": {
    "code": 409,
    "message": "Shipment with AWB AWB999888777 already exists"
  }
}
```

---

### 4. Update Shipment

```
PUT /api/shipments/:awb   # Full update
PATCH /api/shipments/:awb # Partial update
```

**Example Request:**

```bash
# Update status
curl -X PATCH "https://your-domain.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "statusCode": "DEL",
    "statusDescription": "Delivered",
    "last_status_date": "2026-01-23T15:30:00Z"
  }'

# Update rider assignment
curl -X PATCH "https://your-domain.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "riderName": "Vijay Singh",
    "statusCode": "OFD",
    "statusDescription": "Out for Delivery"
  }'
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "awbNumber": "AWB123456789",
    "statusCode": "DEL",
    "updated_at": "2026-01-23T15:30:00Z",
    ...
  }
}
```

---

### 5. Delete Shipment

```
DELETE /api/shipments/:awb
```

> **Note:** Only admin users or API key holders can delete shipments.

**Example Request:**

```bash
curl -X DELETE "https://your-domain.vercel.app/api/shipments/AWB123456789" \
  -H "X-API-Key: your-api-key"
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "awbNumber": "AWB123456789"
  }
}
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
    "details": ["awbNumber is required", "collectable_value must be a number"]
  }
}
```

**Common Error Codes:**

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing/invalid auth |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 422 | Unprocessable - Validation failed |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Error - Server error |

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

## Postman Collection

Import this collection to test the API:

```json
{
  "info": { "name": "Shipments API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "variable": [
    { "key": "baseUrl", "value": "https://your-domain.vercel.app/api" },
    { "key": "apiKey", "value": "your-api-key" }
  ],
  "item": [
    {
      "name": "List Shipments",
      "request": {
        "method": "GET",
        "header": [{ "key": "X-API-Key", "value": "{{apiKey}}" }],
        "url": { "raw": "{{baseUrl}}/shipments?limit=10", "host": ["{{baseUrl}}"], "path": ["shipments"] }
      }
    },
    {
      "name": "Get Shipment",
      "request": {
        "method": "GET",
        "header": [{ "key": "X-API-Key", "value": "{{apiKey}}" }],
        "url": { "raw": "{{baseUrl}}/shipments/AWB123456789", "host": ["{{baseUrl}}"], "path": ["shipments", "AWB123456789"] }
      }
    }
  ]
}
```

---

## Environment Variables

Set these in Vercel dashboard:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server-side) |
| `SUPABASE_ANON_KEY` | Yes | Anon key (for user auth) |
| `API_KEY` | Recommended | API key for machine-to-machine auth |

---

*Module Version: 1.0.0*
