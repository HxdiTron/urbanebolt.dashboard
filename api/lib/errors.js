/**
 * Standardized API error handling.
 */

export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const ErrorCodes = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Send error response.
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 * @param {any} details
 */
export function sendError(res, statusCode, message, details = null) {
  res.status(statusCode).json({
    success: false,
    error: {
      code: statusCode,
      message,
      ...(details && { details }),
    },
  });
}

/**
 * Send success response.
 * @param {import('http').ServerResponse} res
 * @param {any} data
 * @param {object} meta
 */
export function sendSuccess(res, data, meta = {}) {
  res.status(200).json({
    success: true,
    data,
    ...meta,
  });
}

/**
 * Handle errors consistently.
 * @param {import('http').ServerResponse} res
 * @param {Error} error
 */
export function handleError(res, error) {
  console.error('[API Error]', error);

  if (error instanceof ApiError) {
    return sendError(res, error.statusCode, error.message, error.details);
  }

  // Supabase errors
  if (error.code === 'PGRST116') {
    return sendError(res, 404, 'Resource not found');
  }
  if (error.code === '23505') {
    return sendError(res, 409, 'Resource already exists');
  }
  if (error.code === '23503') {
    return sendError(res, 400, 'Invalid reference');
  }

  // Default to internal error
  return sendError(res, 500, 'Internal server error');
}
