// core/libs/http/ResponseNormalizer.js
/**
 * Response Normalizer for Supabase Controller
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Normalizes raw query results into API response format
 */

/**
 * Normalizes raw query results into API response format
 * @param {Array} rawDocs - Documents from database (may include +1 extra for hasMore detection)
 * @param {number} limit - Original limit requested
 * @param {string} orderByField - Field used for ordering (for cursor value)
 * @param {number} totalCount - Total count of documents matching the query (optional)
 * @returns {Object} - Normalized response
 */
export function normalizeResponse(rawDocs, limit, orderByField = 'id', totalCount = null) {
  if (!Array.isArray(rawDocs)) {
    throw new Error('rawDocs must be an array')
  }

  if (limit < 1 || !Number.isInteger(limit)) {
    throw new Error('limit must be a positive integer')
  }

  // Determine if there are more records (we fetched limit + 1)
  const hasMore = rawDocs.length > limit

  // Return only the requested limit of docs
  const docs = hasMore ? rawDocs.slice(0, limit) : rawDocs

  // Get the cursor value from the last document (for next page)
  // Use composite cursor format: "orderByValue___id" to handle NULL orderBy values
  let nextCursor = null
  if (hasMore && docs.length > 0) {
    const lastDoc = docs[docs.length - 1]
    const orderByValue = lastDoc[orderByField]
    const idValue = lastDoc.id

    if (!idValue) {
      console.warn('[ResponseNormalizer] Last document has no ID, cannot generate cursor')
    } else {
      // Generate composite cursor: "orderByValue___id"
      // This ensures pagination works even when orderByField is NULL
      if (orderByValue !== null && orderByValue !== undefined) {
        // Convert dates to ISO string for cursor
        let serializedValue
        if (orderByValue instanceof Date) {
          serializedValue = orderByValue.toISOString()
        } else {
          serializedValue = String(orderByValue)
        }
        // Composite cursor format: "value___id"
        nextCursor = `${serializedValue}___${idValue}`
      } else {
        // orderBy field is NULL, use ID-only cursor
        // PostgresReader will look up the orderBy value when needed
        nextCursor = String(idValue)
      }
    }
  }

  return {
    success: true,
    data: {
      docs,
      pagination: {
        found: docs.length,  // Count of docs in THIS response (not total)
        total: totalCount,   // Total count of documents matching the query
        hasMore,
        nextCursor
      }
    }
  }
}
