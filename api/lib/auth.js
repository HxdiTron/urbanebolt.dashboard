/**
 * Authentication and authorization middleware.
 * Supports: API Key, JWT (Supabase Auth)
 */

import { getAdminClient } from './supabase.js';
import { ApiError } from './errors.js';

const API_KEY = process.env.API_KEY;

/**
 * Validate API key from X-API-Key header.
 * @param {string} apiKey
 * @returns {boolean}
 */
function validateApiKey(apiKey) {
  if (!API_KEY) {
    console.warn('[Auth] API_KEY not configured - API key auth disabled');
    return false;
  }
  return apiKey === API_KEY;
}

/**
 * Validate JWT token and return user.
 * @param {string} token
 * @returns {Promise<{user: object, role: string}>}
 */
async function validateJwt(token) {
  const supabase = getAdminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  // Get user role from custom users table (if exists)
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  return {
    user,
    role: profile?.role || 'user',
  };
}

/**
 * Authentication middleware.
 * Checks X-API-Key header first, then Authorization Bearer token.
 * 
 * @param {import('http').IncomingMessage} req
 * @param {object} options
 * @param {boolean} options.required - Whether auth is required (default: true)
 * @param {string[]} options.roles - Allowed roles (default: any authenticated)
 * @returns {Promise<{user: object|null, role: string|null, authMethod: string|null}>}
 */
export async function authenticate(req, options = {}) {
  const { required = true, roles = [] } = options;
  
  // Check API Key first
  const apiKey = req.headers['x-api-key'];
  if (apiKey && validateApiKey(apiKey)) {
    return { user: null, role: 'api', authMethod: 'api_key' };
  }

  // Check JWT token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { user, role } = await validateJwt(token);

    // Check role-based access
    if (roles.length > 0 && !roles.includes(role)) {
      throw new ApiError(403, `Access denied. Required roles: ${roles.join(', ')}`);
    }

    return { user, role, authMethod: 'jwt' };
  }

  // No valid auth provided
  if (required) {
    throw new ApiError(401, 'Authentication required. Provide X-API-Key or Authorization: Bearer <token>');
  }

  return { user: null, role: null, authMethod: null };
}

/**
 * Require specific roles.
 * @param {string[]} allowedRoles
 */
export function requireRoles(...allowedRoles) {
  return { roles: allowedRoles };
}
