/**
 * Shipments API - List and Create
 * 
 * GET  /api/shipments - List shipments with filters
 * POST /api/shipments - Create a new shipment
 */

import { getAdminClient } from '../lib/supabase.js';
import { authenticate } from '../lib/auth.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import { sendSuccess, sendError, handleError, ApiError } from '../lib/errors.js';

// Allowed fields for select (prevents exposing sensitive data)
const ALLOWED_FIELDS = [
  'awbNumber', 'order_number', 'customerName', 'customerCode',
  'origin', 'originPincode', 'destination', 'destinationPincode',
  'collectable_value', 'declared_value', 'serviceType', 'product_type',
  'statusCode', 'statusDescription', 'edd', 'riderName', 'attemptCount',
  'pickup_date', 'last_status_date', 'created_at', 'updated_at',
  'first_udReason', 'last_udReason'
];

// Query parameter schema
const listQuerySchema = {
  // Filters
  pickup_date: { type: 'date' },
  shipment_type: { type: 'enum', values: ['COD', 'PPD'] },
  status: { type: 'string' },
  awb: { type: 'string' },
  customer_code: { type: 'string' },
  
  // Pagination
  limit: { type: 'number', min: 1, max: 1000, default: 100 },
  offset: { type: 'number', min: 0, default: 0 },
  cursor: { type: 'string' },
  
  // Sorting
  sort_by: { type: 'enum', values: ['created_at', 'pickup_date', 'awbNumber', 'statusCode'], default: 'created_at' },
  sort_order: { type: 'enum', values: ['asc', 'desc'], default: 'desc' },
};

// Create shipment body schema
const createBodySchema = {
  awbNumber: { type: 'string', required: true, minLength: 5, maxLength: 50 },
  order_number: { type: 'string', maxLength: 100 },
  customerName: { type: 'string', maxLength: 200 },
  customerCode: { type: 'string', maxLength: 50 },
  origin: { type: 'string', maxLength: 100 },
  originPincode: { type: 'string', maxLength: 10 },
  destination: { type: 'string', maxLength: 100 },
  destinationPincode: { type: 'string', maxLength: 10 },
  collectable_value: { type: 'number', min: 0, default: 0 },
  declared_value: { type: 'number', min: 0, default: 0 },
  serviceType: { type: 'string', maxLength: 50 },
  product_type: { type: 'string', maxLength: 50 },
  statusCode: { type: 'string', maxLength: 20, default: 'NEW' },
  statusDescription: { type: 'string', maxLength: 200 },
  edd: { type: 'string' },
  riderName: { type: 'string', maxLength: 100 },
  pickup_date: { type: 'string' },
};

/**
 * List shipments with filters and pagination.
 */
async function listShipments(req, res) {
  const params = validateQuery(req.query, listQuerySchema);
  const supabase = getAdminClient();

  let query = supabase
    .from('shipments')
    .select(ALLOWED_FIELDS.join(','), { count: 'exact' });

  // Apply filters
  if (params.pickup_date) {
    query = query.eq('pickup_date', params.pickup_date);
  }

  if (params.shipment_type) {
    if (params.shipment_type === 'COD') {
      query = query.gt('collectable_value', 0);
    } else {
      query = query.or('collectable_value.is.null,collectable_value.eq.0');
    }
  }

  if (params.status) {
    query = query.eq('statusCode', params.status.toUpperCase());
  }

  if (params.awb) {
    // Support partial AWB search
    query = query.ilike('awbNumber', `%${params.awb}%`);
  }

  if (params.customer_code) {
    query = query.eq('customerCode', params.customer_code);
  }

  // Cursor-based pagination (if cursor provided)
  if (params.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(params.cursor, 'base64').toString());
      if (params.sort_order === 'desc') {
        query = query.lt(params.sort_by, cursor.value);
      } else {
        query = query.gt(params.sort_by, cursor.value);
      }
    } catch {
      throw new ApiError(400, 'Invalid cursor');
    }
  }

  // Apply sorting and pagination
  query = query
    .order(params.sort_by, { ascending: params.sort_order === 'asc' })
    .range(params.offset, params.offset + params.limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  // Generate next cursor
  let nextCursor = null;
  if (data && data.length === params.limit) {
    const lastItem = data[data.length - 1];
    nextCursor = Buffer.from(JSON.stringify({
      value: lastItem[params.sort_by],
      id: lastItem.awbNumber
    })).toString('base64');
  }

  return sendSuccess(res, data, {
    pagination: {
      total: count,
      limit: params.limit,
      offset: params.offset,
      hasMore: data?.length === params.limit,
      nextCursor,
    },
  });
}

/**
 * Create a new shipment.
 */
async function createShipment(req, res) {
  const body = validateBody(req.body, createBodySchema);
  const supabase = getAdminClient();

  // Check if AWB already exists
  const { data: existing } = await supabase
    .from('shipments')
    .select('awbNumber')
    .eq('awbNumber', body.awbNumber)
    .single();

  if (existing) {
    throw new ApiError(409, `Shipment with AWB ${body.awbNumber} already exists`);
  }

  // Insert new shipment
  const { data, error } = await supabase
    .from('shipments')
    .insert({
      ...body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select(ALLOWED_FIELDS.join(','))
    .single();

  if (error) {
    throw error;
  }

  res.status(201);
  return sendSuccess(res, data);
}

/**
 * Main handler.
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Authenticate request
    await authenticate(req, { required: true });

    switch (req.method) {
      case 'GET':
        return await listShipments(req, res);
      case 'POST':
        return await createShipment(req, res);
      default:
        return sendError(res, 405, `Method ${req.method} not allowed`);
    }
  } catch (error) {
    return handleError(res, error);
  }
}
