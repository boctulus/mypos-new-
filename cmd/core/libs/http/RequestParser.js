// core/libs/http/RequestParser.js
/**
 * Request Parser for Supabase Controller
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Parses and validates HTTP request parameters for Supabase queries
 */

import { SUPABASE_CONFIG } from '../../../config/supabase.config.js'

/**
 * Parses and validates request parameters
 * @param {Object} req - Express request object
 * @returns {Object} Parsed query options
 * @throws {Error} If validation fails
 */
export function parseRequest(req) {
  const collection = req.params.collection

  // Validate collection name (whitelist)
  if (!SUPABASE_CONFIG.ALLOWED_COLLECTIONS.includes(collection)) {
    throw new Error(`Invalid collection: ${collection}. Allowed: ${SUPABASE_CONFIG.ALLOWED_COLLECTIONS.join(', ')}`)
  }

  // Parse and validate limit
  let rawLimit = SUPABASE_CONFIG.DEFAULT_LIMIT

  if (req.query.limit !== undefined) {
    rawLimit = parseInt(req.query.limit)

    if (isNaN(rawLimit)) {
      throw new Error('Invalid limit parameter - must be a number')
    }
  }

  const limit = Math.min(
    Math.max(1, rawLimit),
    SUPABASE_CONFIG.MAX_LIMIT
  )

  // Parse order parameters
  const orderBy = req.query.orderBy || 'id'
  const order = req.query.order === 'desc' ? 'desc' : 'asc'

  // Warn if orderBy is not in safe list (may not be indexed)
  const safeOrderFields = ['id', 'created_at', 'updated_at', 'name', 'title']
  if (!safeOrderFields.includes(orderBy)) {
    console.warn(`[WARN] orderBy=${orderBy} may not be indexed, could impact performance`)
  }

  // Parse include (comma-separated collection names)
  const include = (req.query.include || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean) || []

  // Parse depth (limit to reasonable value)
  const depth = Math.max(1, Math.min(parseInt(req.query.depth) || 1, 10))

  // Parse search fields
  const searchFields = (req.query.searchFields || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean) || []

  // Validate: if q is provided, searchFields must be provided
  const q = (req.query.q || '').trim() || null
  if (q && searchFields.length === 0) {
    throw new Error('searchFields required when q (search query) is provided')
  }

  return {
    collection,
    q,
    searchFields,
    orderBy,
    order,
    limit,
    startAfter: req.query.startAfterDocId || null,
    include,
    depth
  }
}
