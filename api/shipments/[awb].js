/**
 * Shipments API - Single Shipment Operations
 * 
 * GET    /api/shipments/:awb - Get shipment details
 * PUT    /api/shipments/:awb - Full update
 * PATCH  /api/shipments/:awb - Partial update
 * DELETE /api/shipments/:awb - Delete shipment
 */

import { getAdminClient } from '../lib/supabase.js';
import { authenticate } from '../lib/auth.js';
import { validateBody } from '../lib/validate.js';
import { sendSuccess, sendError, handleError, ApiError } from '../lib/errors.js';

// Allowed fields for select
const ALLOWED_FIELDS = [
  'awbNumber', 'order_number', 'customerName', 'customerCode',
  'origin', 'originPincode', 'destination', 'destinationPincode',
  'collectable_value', 'declared_value', 'serviceType', 'product_type',
  'statusCode', 'statusDescription', 'edd', 'riderName', 'attemptCount',
  'pickup_date', 'last_status_date', 'created_at', 'updated_at',
  'first_udReason', 'last_udReason'
];

// Updatable fields (prevents updating immutable fields)
const UPDATABLE_FIELDS = [
  'order_number', 'customerName', 'customerCode',
  'origin', 'originPincode', 'destination', 'destinationPincode',
  'collectable_value', 'declared_value', 'serviceType', 'product_type',
  'statusCode', 'statusDescription', 'edd', 'riderName', 'attemptCount',
  'pickup_date', 'last_status_date', 'first_udReason', 'last_udReason'
];

// Update body schema
const updateBodySchema = {
  order_number: { type: 'string', maxLength: 100 },
  customerName: { type: 'string', maxLength: 200 },
  customerCode: { type: 'string', maxLength: 50 },
  origin: { type: 'string', maxLength: 100 },
  originPincode: { type: 'string', maxLength: 10 },
  destination: { type: 'string', maxLength: 100 },
  destinationPincode: { type: 'string', maxLength: 10 },
  collectable_value: { type: 'number', min: 0 },
  declared_value: { type: 'number', min: 0 },
  serviceType: { type: 'string', maxLength: 50 },
  product_type: { type: 'string', maxLength: 50 },
  statusCode: { type: 'string', maxLength: 20 },
  statusDescription: { type: 'string', maxLength: 200 },
  edd: { type: 'string' },
  riderName: { type: 'string', maxLength: 100 },
  attemptCount: { type: 'number', min: 0 },
  pickup_date: { type: 'string' },
  last_status_date: { type: 'string' },
  first_udReason: { type: 'string', maxLength: 500 },
  last_udReason: { type: 'string', maxLength: 500 },
};

/**
 * Get a single shipment by AWB.
 */
async function getShipment(req, res, awb) {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from('shipments')
    .select(ALLOWED_FIELDS.join(','))
    .eq('awbNumber', awb)
    .single();

  if (error && error.code === 'PGRST116') {
    throw new ApiError(404, `Shipment ${awb} not found`);
  }

  if (error) {
    throw error;
  }

  return sendSuccess(res, data);
}

/**
 * Update a shipment (full or partial).
 */
async function updateShipment(req, res, awb, partial = false) {
  const supabase = getAdminClient();

  // Validate body (all fields optional for PATCH, validate provided ones)
  const body = validateBody(req.body, updateBodySchema);

  // Filter to only updatable fields
  const updates = {};
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'No valid fields to update');
  }

  // Add updated timestamp
  updates.updated_at = new Date().toISOString();

  // Update shipment
  const { data, error } = await supabase
    .from('shipments')
    .update(updates)
    .eq('awbNumber', awb)
    .select(ALLOWED_FIELDS.join(','))
    .single();

  if (error && error.code === 'PGRST116') {
    throw new ApiError(404, `Shipment ${awb} not found`);
  }

  if (error) {
    throw error;
  }

  return sendSuccess(res, data);
}

/**
 * Delete a shipment.
 */
async function deleteShipment(req, res, awb, auth) {
  // Only allow admins or API key to delete
  if (auth.role !== 'admin' && auth.authMethod !== 'api_key') {
    throw new ApiError(403, 'Only admins can delete shipments');
  }

  const supabase = getAdminClient();

  // Check if exists first
  const { data: existing, error: checkError } = await supabase
    .from('shipments')
    .select('awbNumber')
    .eq('awbNumber', awb)
    .single();

  if (checkError && checkError.code === 'PGRST116') {
    throw new ApiError(404, `Shipment ${awb} not found`);
  }

  // Delete
  const { error } = await supabase
    .from('shipments')
    .delete()
    .eq('awbNumber', awb);

  if (error) {
    throw error;
  }

  return sendSuccess(res, { deleted: true, awbNumber: awb });
}

/**
 * Main handler.
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { awb } = req.query;

  if (!awb || typeof awb !== 'string') {
    return sendError(res, 400, 'AWB number is required');
  }

  try {
    // Authenticate request
    const auth = await authenticate(req, { required: true });

    switch (req.method) {
      case 'GET':
        return await getShipment(req, res, awb);
      case 'PUT':
        return await updateShipment(req, res, awb, false);
      case 'PATCH':
        return await updateShipment(req, res, awb, true);
      case 'DELETE':
        return await deleteShipment(req, res, awb, auth);
      default:
        return sendError(res, 405, `Method ${req.method} not allowed`);
    }
  } catch (error) {
    return handleError(res, error);
  }
}
