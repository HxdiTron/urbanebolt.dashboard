/**
 * Input validation utilities.
 * Simple validation without external dependencies.
 */

import { ApiError } from './errors.js';

/**
 * Validate and parse query parameters.
 * @param {object} query - Request query object
 * @param {object} schema - Validation schema
 * @returns {object} Parsed and validated parameters
 */
export function validateQuery(query, schema) {
  const result = {};
  const errors = [];

  for (const [key, rules] of Object.entries(schema)) {
    const value = query[key];

    // Check required
    if (rules.required && (value === undefined || value === '')) {
      errors.push(`${key} is required`);
      continue;
    }

    if (value === undefined || value === '') {
      result[key] = rules.default;
      continue;
    }

    // Type coercion and validation
    let parsed = value;
    
    if (rules.type === 'number') {
      parsed = Number(value);
      if (isNaN(parsed)) {
        errors.push(`${key} must be a number`);
        continue;
      }
      if (rules.min !== undefined && parsed < rules.min) {
        errors.push(`${key} must be at least ${rules.min}`);
        continue;
      }
      if (rules.max !== undefined && parsed > rules.max) {
        errors.push(`${key} must be at most ${rules.max}`);
        continue;
      }
    }

    if (rules.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`${key} must be in YYYY-MM-DD format`);
        continue;
      }
      parsed = value;
    }

    if (rules.type === 'enum' && rules.values) {
      if (!rules.values.includes(value)) {
        errors.push(`${key} must be one of: ${rules.values.join(', ')}`);
        continue;
      }
    }

    if (rules.type === 'boolean') {
      parsed = value === 'true' || value === '1';
    }

    result[key] = parsed;
  }

  if (errors.length > 0) {
    throw new ApiError(400, 'Validation failed', errors);
  }

  return result;
}

/**
 * Validate request body.
 * @param {object} body - Request body
 * @param {object} schema - Validation schema
 * @returns {object} Validated body
 */
export function validateBody(body, schema) {
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Request body must be a JSON object');
  }

  const result = {};
  const errors = [];

  for (const [key, rules] of Object.entries(schema)) {
    const value = body[key];

    // Check required
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${key} is required`);
      continue;
    }

    if (value === undefined || value === null) {
      if (rules.default !== undefined) {
        result[key] = rules.default;
      }
      continue;
    }

    // Type validation
    if (rules.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${key} must be a string`);
        continue;
      }
      if (rules.minLength && value.length < rules.minLength) {
        errors.push(`${key} must be at least ${rules.minLength} characters`);
        continue;
      }
      if (rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${key} must be at most ${rules.maxLength} characters`);
        continue;
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${key} has invalid format`);
        continue;
      }
    }

    if (rules.type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`${key} must be a number`);
        continue;
      }
      if (rules.min !== undefined && value < rules.min) {
        errors.push(`${key} must be at least ${rules.min}`);
        continue;
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(`${key} must be at most ${rules.max}`);
        continue;
      }
    }

    if (rules.type === 'enum' && rules.values) {
      if (!rules.values.includes(value)) {
        errors.push(`${key} must be one of: ${rules.values.join(', ')}`);
        continue;
      }
    }

    result[key] = value;
  }

  if (errors.length > 0) {
    throw new ApiError(400, 'Validation failed', errors);
  }

  return result;
}

/**
 * Common validation schemas.
 */
export const schemas = {
  awbNumber: {
    type: 'string',
    required: true,
    minLength: 5,
    maxLength: 50,
    pattern: /^[A-Za-z0-9-]+$/,
  },
  pagination: {
    limit: { type: 'number', min: 1, max: 1000, default: 100 },
    offset: { type: 'number', min: 0, default: 0 },
    cursor: { type: 'string' },
  },
};
