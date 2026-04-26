// core/database/libs/readers/SupabaseReader.js
/**
 * Supabase Reader - Core Adapter for CRUD Operations
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Main adapter for Supabase with complete CRUD operations (Create, Read, Update, Delete)
 * Provides Firebase-compatible interface for both read and write operations
 */

import { SUPABASE_CONFIG } from '../../../../config/supabase.config.js'

export class SupabaseReader {
  constructor(client, config = {}) {
    this.client = client
    this.timeout = config.timeout || SUPABASE_CONFIG.QUERY_TIMEOUT_MS
    this.maxRetries = config.maxRetries || SUPABASE_CONFIG.MAX_RETRIES
    this.retryDelayMs = config.retryDelayMs || SUPABASE_CONFIG.RETRY_DELAY_MS
  }

  /**
   * Logs with proper level filtering
   * @private
   */
  _log(level, message, data = {}) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    const configLevel = levels[SUPABASE_CONFIG.LOG_LEVEL] || 1

    if (levels[level] >= configLevel) {
      console.log(`[${level.toUpperCase()}]`, message, Object.keys(data).length > 0 ? data : '')
    }
  }

  /**
   * Escapes special ILIKE characters for substring search
   * @private
   */
  _escapeLike(str) {
    if (!str) return str
    // Escape special LIKE characters: %, _, and backslash
    return str.replace(/[\\%_]/g, '\\$&')
  }

  /**
   * Executes a query with timeout and retry logic
   * @private
   */
  async _executeQuery(query) {
    let lastError
    let retries = 0

    while (retries <= this.maxRetries) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Query timeout')), this.timeout)
        })

        // Race between query and timeout
        const { data, error } = await Promise.race([query, timeoutPromise])

        if (error) {
          throw new Error(`Database error: ${error.message}`)
        }

        return data || []

      } catch (err) {
        lastError = err

        // Don't retry on client errors
        if (err.message.includes('Invalid')) {
          throw err
        }

        // Retry on transient errors
        if (retries < this.maxRetries) {
          retries++
          const delayMs = this.retryDelayMs * Math.pow(2, retries - 1)
          this._log('debug', `Query retry ${retries}/${this.maxRetries} after ${delayMs}ms`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        } else {
          break
        }
      }
    }

    throw lastError || new Error('Query failed after retries')
  }

  /**
   * Main query builder - builds and executes query
   */
  async find(options) {
    if (!options.collection) {
      throw new Error('Collection name is required')
    }

    if (options.limit < 1 || options.limit > SUPABASE_CONFIG.MAX_LIMIT) {
      throw new Error(`Limit must be between 1 and ${SUPABASE_CONFIG.MAX_LIMIT}`)
    }

    let query = this.client
      .from(options.collection)
      .select('*')

    // Full-text search with ILIKE (substring matching)
    if (options.q && options.q.trim()) {
      if (!options.searchFields?.length) {
        throw new Error('searchFields required when q is provided')
      }

      const escapedQ = this._escapeLike(options.q.trim())
      const pattern = `%${escapedQ}%`

      // Build OR conditions for multiple search fields
      const orConditions = options.searchFields
        .map(f => `${f}.ilike.${pattern}`)
        .join(',')

      query = query.or(orConditions)
    }

    // Cursor-based pagination using the orderBy field value
    if (options.startAfter) {
      const operator = options.order === 'asc' ? 'gt' : 'lt'
      query = query.filter(options.orderBy, operator, options.startAfter)
    }

    // Order and limit (fetch limit + 1 to detect hasMore)
    query = query
      .order(options.orderBy, { ascending: options.order === 'asc' })
      .limit(options.limit + 1)

    const data = await this._executeQuery(query)
    this._log('debug', `Query executed`, {
      collection: options.collection,
      returned: data.length,
      hasMore: data.length > options.limit
    })

    return data
  }

  /**
   * Query with related data (includes) - depth 1 only
   */
  async findWithIncludes(options) {
    const docs = await this.find(options)

    if (!options.include?.length || docs.length === 0) {
      return docs
    }

    // Warn if depth > 1 requested
    if (options.depth && options.depth > 1) {
      this._log('warn', `depth=${options.depth} requested but only depth=1 is supported`)
    }

    // Resolve includes (one level only)
    for (const relatedCollection of options.include) {
      // Filter out docs to process only those with relevant data
      const docsWithRelation = docs.filter(d => d.id)
      if (docsWithRelation.length === 0) continue

      try {
        await this._resolveInclude(docsWithRelation, options.collection, relatedCollection)
      } catch (error) {
        this._log('error', `Failed to resolve include: ${relatedCollection}`, {
          error: error.message
        })
        // Don't fail entirely, just attach empty arrays
        docsWithRelation.forEach(doc => {
          if (!doc.hasOwnProperty(relatedCollection)) {
            doc[relatedCollection] = []
          }
        })
      }
    }

    return docs
  }

  /**
   * Resolves a single include relationship (1:N or N:1)
   * Assumes foreign key naming: {singularCollectionName}_id
   * @private
   */
  async _resolveInclude(parentDocs, parentCollection, relatedCollection) {
    if (!parentDocs.length) return

    // Get the foreign key name (e.g., user_id for users, category_id for categories)
    const foreignKey = SUPABASE_CONFIG.FK_CONVENTION(parentCollection)

    // Extract parent IDs to look up related records
    const parentIds = parentDocs
      .map(d => d.id)
      .filter(Boolean)

    if (parentIds.length === 0) return

    this._log('debug', `Resolving include: ${relatedCollection}`, {
      parentCollection,
      parentCount: parentDocs.length,
      foreignKey
    })

    try {
      // Query related records that match parent IDs via FK
      const relatedData = await this._executeQuery(
        this.client
          .from(relatedCollection)
          .select('*')
          .in(foreignKey, parentIds)
      )

      // Attach related records to each parent doc
      // Each parent can have multiple related records
      parentDocs.forEach(parentDoc => {
        // Don't overwrite if property already exists
        if (!parentDoc.hasOwnProperty(relatedCollection)) {
          parentDoc[relatedCollection] = (relatedData || []).filter(
            relatedDoc => relatedDoc[foreignKey] === parentDoc.id
          )
        }
      })

      this._log('debug', `Include resolved`, {
        relatedCollection,
        recordsFound: relatedData?.length || 0
      })

    } catch (error) {
      this._log('error', `Failed to load ${relatedCollection}: ${error.message}`)
      // Attach empty array instead of failing entirely
      parentDocs.forEach(doc => {
        if (!doc.hasOwnProperty(relatedCollection)) {
          doc[relatedCollection] = []
        }
      })
    }
  }

  /**
   * Executes a write operation with timeout and retry logic
   * @private
   */
  async _executeWrite(operation) {
    let lastError
    let retries = 0

    while (retries <= this.maxRetries) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Write operation timeout')), this.timeout)
        })

        // Race between operation and timeout
        const { data, error } = await Promise.race([operation, timeoutPromise])

        if (error) {
          throw new Error(`Database error: ${error.message}`)
        }

        return data

      } catch (err) {
        lastError = err

        // Don't retry on client errors (4xx)
        if (err.message.includes('Invalid') ||
            err.message.includes('duplicate') ||
            err.message.includes('constraint') ||
            err.message.includes('not found')) {
          throw err
        }

        // Retry on transient errors (5xx, network, timeout)
        if (retries < this.maxRetries) {
          retries++
          const delayMs = this.retryDelayMs * Math.pow(2, retries - 1)
          this._log('debug', `Write retry ${retries}/${this.maxRetries} after ${delayMs}ms`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        } else {
          break
        }
      }
    }

    throw lastError || new Error('Write operation failed after retries')
  }

  /**
   * Creates a new record
   * @param {string} collection - Table name
   * @param {object} data - Record data
   * @returns {Promise<object>} Created record
   */
  async create(collection, data) {
    if (!collection) {
      throw new Error('Collection name is required')
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Data must be a non-empty object')
    }

    this._log('debug', `Creating record in ${collection}`, { data })

    const operation = this.client
      .from(collection)
      .insert(data)
      .select()
      .single()

    const result = await this._executeWrite(operation)

    this._log('info', `Record created in ${collection}`, {
      id: result?.id
    })

    return result
  }

  /**
   * Updates an existing record by ID
   * @param {string} collection - Table name
   * @param {string} id - Record ID
   * @param {object} data - Update data
   * @returns {Promise<object>} Updated record
   */
  async update(collection, id, data) {
    if (!collection) {
      throw new Error('Collection name is required')
    }

    if (!id) {
      throw new Error('Record ID is required')
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Data must be a non-empty object')
    }

    this._log('debug', `Updating record ${id} in ${collection}`, { data })

    // First check if record exists
    const existingRecord = await this._executeWrite(
      this.client
        .from(collection)
        .select('id')
        .eq('id', id)
        .single()
    )

    if (!existingRecord) {
      throw new Error(`Record ${id} not found in ${collection}`)
    }

    // Perform update
    const operation = this.client
      .from(collection)
      .update(data)
      .eq('id', id)
      .select()
      .single()

    const result = await this._executeWrite(operation)

    this._log('info', `Record updated in ${collection}`, { id })

    return result
  }

  /**
   * Deletes a record by ID
   * @param {string} collection - Table name
   * @param {string} id - Record ID
   * @returns {Promise<boolean>} Success status
   */
  async delete(collection, id) {
    if (!collection) {
      throw new Error('Collection name is required')
    }

    if (!id) {
      throw new Error('Record ID is required')
    }

    this._log('debug', `Deleting record ${id} from ${collection}`)

    // First check if record exists
    const existingRecord = await this._executeWrite(
      this.client
        .from(collection)
        .select('id')
        .eq('id', id)
        .single()
    )

    if (!existingRecord) {
      throw new Error(`Record ${id} not found in ${collection}`)
    }

    // Perform delete
    const operation = this.client
      .from(collection)
      .delete()
      .eq('id', id)

    await this._executeWrite(operation)

    this._log('info', `Record deleted from ${collection}`, { id })

    return true
  }

  /**
   * Gets a single record by ID
   * @param {string} collection - Table name
   * @param {string} id - Record ID
   * @returns {Promise<object|null>} Record or null if not found
   */
  async getById(collection, id) {
    if (!collection) {
      throw new Error('Collection name is required')
    }

    if (!id) {
      throw new Error('Record ID is required')
    }

    this._log('debug', `Getting record ${id} from ${collection}`)

    try {
      const operation = this.client
        .from(collection)
        .select('*')
        .eq('id', id)
        .single()

      const result = await this._executeWrite(operation)

      return result || null

    } catch (err) {
      if (err.message.includes('not found')) {
        return null
      }
      throw err
    }
  }

  /**
   * Upsert operation - insert or update if exists
   * @param {string} collection - Table name
   * @param {object} data - Record data (must include id for update)
   * @returns {Promise<object>} Created or updated record
   */
  async upsert(collection, data) {
    if (!collection) {
      throw new Error('Collection name is required')
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Data must be a non-empty object')
    }

    this._log('debug', `Upserting record in ${collection}`, { data })

    const operation = this.client
      .from(collection)
      .upsert(data)
      .select()
      .single()

    const result = await this._executeWrite(operation)

    this._log('info', `Record upserted in ${collection}`, {
      id: result?.id
    })

    return result
  }
}
