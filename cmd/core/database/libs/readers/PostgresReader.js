/**
 * PostgreSQL Reader (Direct Connection)
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Reader for PostgreSQL using pg driver directly (without PostgREST)
 */

import pg from 'pg'
const { Pool } = pg
import PgPoolManager from '../connection/pgsql/PgPoolManager.js'

/**
 * PostgresReader - Direct PostgreSQL queries without PostgREST
 * Compatible API with SupabaseReader
 */
export class PostgresReader {
  constructor(dbAdapter, config = {}) {
    this.db = dbAdapter;  // DatabaseAdapter instance
    this.config = config;
    this.schema = config.schema || 'public';

    this.timeout = config.timeout || 30000
    this.maxRetries = config.maxRetries || 3
    this.retryDelayMs = config.retryDelayMs || 1000
    this.logLevel = config.logLevel || 'info'
  }

  /**
   * Unified read method compatible with FirestoreReader.read
   * Returns { docs, pagination }
   */
  async read(collection, options = {}) {
    const docs = await this.findWithIncludes({ ...options, collection });
    const total = await this.count({ ...options, collection });

    // Construct pagination info similar to FirestoreReader
    const limit = parseInt(options.limit) || 20;

    // Adjust docs if we fetched +1 for hasMore check (find method implementation detail)
    // find() adds LIMIT limit + 1.
    // If we used findWithIncludes -> find, it returns limit+1 docs if available.
    // We should slice it here to return exact limit.
    const finalDocs = docs.length > limit ? docs.slice(0, limit) : docs;

    // Generate nextCursor for Supabase compatibility
    let nextCursor = null;
    if (docs.length > limit) {
      // Use the ID of the last visible document as cursor
      const lastDoc = finalDocs[finalDocs.length - 1];
      nextCursor = lastDoc ? lastDoc.id || lastDoc[this._getIdField()] : null;
    }

    const pagination = {
      found: finalDocs.length, // ✅ FIX: Use finalDocs (after slice) not docs
      total: total,
      hasMore: docs.length > limit, // Note: find() fetches limit + 1
      page: parseInt(options.page) || 1, // Postgres specific if offset used
      limit: limit,
      nextCursor: nextCursor
    };

    return { docs: finalDocs, pagination };
  }

  /**
   * Internal logger
   */
  _log(level, message, data = {}) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    const configLevel = levels[this.logLevel] !== undefined ? levels[this.logLevel] : 1

    if (levels[level] >= configLevel) {
      console.log(`[PostgresReader ${level.toUpperCase()}] ${message}`, data)
    }
  }

  /**
   * Escape LIKE pattern special characters
   */
  _escapeLike(str) {
    return str.replace(/[%_\\]/g, '\\$&')
  }

  /**
   * Get the ID field name for a document
   * Tries common ID field names in order of preference
   */
  _getIdField() {
    // Common primary key field names in order of preference
    const commonIdFields = ['id', 'uid', 'uuid', 'pk', 'primary_key'];
    return commonIdFields[0]; // Default to 'id' - can be enhanced if needed
  }

  /**
   * Get schema-qualified and quoted collection name
   */
  _getCollectionName(collection) {
    if (!collection) return null;

    // If it's already qualified (contains a dot), split and quote both parts
    if (collection.includes('.')) {
      const parts = collection.split('.');
      return parts.map(part => `"${part}"`).join('.');
    }

    return `"${this.schema}"."${collection}"`;
  }

  /**
   * Validate field name to prevent SQL injection
   * Allows: simple fields (user_id), dotted paths (user.name), schema.table.column
   */
  _isValidFieldName(field) {
    if (typeof field !== 'string' || field.trim() === '') return false;
    if (String(field).toLowerCase() === 'nan') return false;

    // Allow dots for relations/JSON access, but validate each part
    const parts = field.split('.');
    return parts.length <= 3 && parts.every(part =>
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)
    );
  }

  /**
   * Parse filter string to field:value pairs
   * Format: "brand:HP && category:Computadoras"
   * Returns: [{ field: 'brand', value: 'HP' }, { field: 'category', value: 'Computadoras' }]
   */
  _parseFilters(filterString) {
    if (!filterString || !filterString.trim()) {
      return []
    }

    try {
      // Split by ' && ' (note the spaces)
      const filterParts = filterString.split(' && ').filter(Boolean)

      return filterParts.map(part => {
        const [field, ...valueParts] = part.split(':')
        const value = valueParts.join(':').trim() // Rejoin in case value contains ':'

        if (!field || !value) {
          this._log('warn', `Invalid filter format: ${part}`)
          return null
        }

        return { field: field.trim(), value }
      }).filter(Boolean)
    } catch (err) {
      this._log('error', 'Error parsing filters', { error: err.message, filterString })
      return []
    }
  }

  /**
   * Internal method to apply filters and search to whereClauses and params
   * @private
   */
  _applyFilters(whereClauses, params, options, startParamCount = 1) {
    let paramCount = startParamCount

    // Apply filters (field:value pairs)
    if (options.filter && options.filter.trim()) {
      const filters = this._parseFilters(options.filter)

      this._log('debug', 'Parsed filters', { filters })

      for (const { field, value } of filters) {
        // Validate field name to prevent SQL injection
        if (!this._isValidFieldName(field)) {
          this._log('warn', `Invalid field name in filter: ${field}`, { field, value });
          continue; // Skip this filter
        }

        // Handle boolean values
        if (value === 'true' || value === 'false') {
          params.push(value === 'true')
          whereClauses.push(`${field} = $${paramCount++}`)
        }
        // Handle null values
        else if (value === 'null') {
          whereClauses.push(`${field} IS NULL`)
          // Don't add a parameter for NULL checks
        }
        // Handle not-null values
        else if (value === '!null') {
          whereClauses.push(`${field} IS NOT NULL`)
          // Don't add a parameter for NOT NULL checks
        }
        else {
          // Use ILIKE for case-insensitive partial matching on strings/numbers/etc
          // We cast the field to text to ensure ILIKE works regardless of column type
          params.push(`%${value}%`)
          whereClauses.push(`${field}::text ILIKE $${paramCount++}`)
        }
      }
    }

    // Full-text search with ILIKE
    if (options.q && options.q.trim() && options.q !== '*') {
      if (!options.searchFields?.length) {
        throw new Error('searchFields required when q is provided')
      }

      const escapedQ = this._escapeLike(options.q.trim())
      const pattern = `%${escapedQ}%`

      const searchConditions = options.searchFields
        .filter(field => {
          // Validate field name to prevent SQL injection
          if (!this._isValidFieldName(field)) {
            this._log('warn', `Invalid field name in searchFields: ${field}`, { field });
            return false; // Skip this field
          }
          return true;
        })
        .map(field => {
          params.push(pattern)
          return `${field}::text ILIKE $${paramCount++}`
        })

      if (searchConditions.length > 0) {
        whereClauses.push(`(${searchConditions.join(' OR ')})`)
      }
    }

    return paramCount
  }

  /**
   * Execute query with retry logic
   */
  async _executeQuery(query, params = []) {
    let lastError
    let retries = 0

    while (retries <= this.maxRetries) {
      try {
        // Execute the query using the database adapter
        // Note: The adapter handles connection management internally
        const result = await this.db.query(query, params);
        return result;
      } catch (err) {
        lastError = err

        // Log the error for debugging
        this._log('error', `Query execution error`, {
          query: query.substring(0, 100) + '...', // First 100 chars of query
          error: err.message,
          stack: err.stack
        });

        // Don't retry on client errors
        if (err.message.includes('Invalid') || err.message.includes('syntax')) {
          throw err
        }

        // If it's a "too many clients" error, we should wait longer before retrying
        // to give other connections time to be released
        if (err.message.includes('too many clients')) {
          retries++
          // Use a longer exponential backoff for connection pool exhaustion
          const delayMs = this.retryDelayMs * Math.pow(3, retries) // More aggressive backoff
          this._log('warn', `Too many clients - retry ${retries}/${this.maxRetries} after ${delayMs}ms`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }

        // Retry on other connection-related errors
        if (err.code === 'ECONNREFUSED' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ENOTFOUND' ||
            err.message.includes('Connection terminated')) {
          retries++
          const delayMs = this.retryDelayMs * Math.pow(2, retries - 1)
          this._log('debug', `Query retry ${retries}/${this.maxRetries} after ${delayMs}ms`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }

        // For other errors, don't retry
        break
      }
    }

    throw new Error(`Database error: ${lastError.message}`)
  }

  /**
   * Main query method - compatible with SupabaseReader.find()
   */
  async find(arg1, arg2) {
    let options = arg1;
    if (typeof arg1 === 'string') {
      options = { ...arg2, collection: arg1 };
    }

    this._log('debug', 'Starting find query', {
      collection: options.collection,
      hasSearch: !!options.q,
      hasFilters: !!options.filter
    })

    // Build WHERE clauses
    const whereClauses = []
    const params = []
    let paramCount = 1

    // Apply structured 'where'
    if (options.where && Array.isArray(options.where)) {
      const opMap = { '==': '=', '!=': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };
      for (const cond of options.where) {
        if (!cond.field || !cond.operator || cond.value === undefined) continue;

        // Validate field name to prevent SQL injection
        if (!this._isValidFieldName(cond.field)) {
          this._log('warn', `Invalid field name in where clause: ${cond.field}`, { cond });
          continue; // Skip this condition
        }

        const sqlOp = opMap[cond.operator] || '=';
        // Handle null checks special case if needed, but params usually work for =
        if (cond.value === null) {
          if (cond.operator === '==' || cond.operator === '=') whereClauses.push(`${cond.field} IS NULL`);
          else if (cond.operator === '!=' || cond.operator === '<>') whereClauses.push(`${cond.field} IS NOT NULL`);
        } else {
          whereClauses.push(`${cond.field} ${sqlOp} $${paramCount++}`);
          params.push(cond.value);
        }
      }
    }

    paramCount = this._applyFilters(whereClauses, params, options, paramCount)

    // Cursor-based pagination
    if (options.startAfter) {
      const operator = options.order === 'asc' ? '>' : '<'
      let orderValue, idValue;

      // Check if this is a composite cursor (format: "value___id")
      // Validate orderBy to prevent SQL injection and invalid column names
      let validatedOrderByForCursor = options.orderBy;
      // Check if the value is actually the NaN constant, or the string 'nan'/'NaN', or if it's not a valid string
      if (!validatedOrderByForCursor ||
        typeof validatedOrderByForCursor !== 'string' ||
        String(validatedOrderByForCursor).toLowerCase() === 'nan' ||
        (typeof validatedOrderByForCursor === 'number' && isNaN(validatedOrderByForCursor)) ||
        validatedOrderByForCursor.trim() === '') {
        validatedOrderByForCursor = 'id'; // Default to 'id' if orderBy is invalid
      }

      // Basic validation to ensure the orderBy field is a valid identifier
      // Only allow alphanumeric characters, underscore, and dot for schema qualification
      const isValidIdentifierForCursor = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(validatedOrderByForCursor);
      if (!isValidIdentifierForCursor) {
        validatedOrderByForCursor = 'id'; // Fallback to 'id' if not a valid identifier
      }

      if (options.startAfter.includes('___')) {
        const parts = options.startAfter.split('___');
        idValue = parts.pop();
        orderValue = parts.join('___');
      } else {
        // ID-only cursor: Fetch the sort value from the database
        idValue = options.startAfter;
        try {
          const qualifiedCollection = this._getCollectionName(options.collection);
          const lookupQuery = `SELECT ${validatedOrderByForCursor} FROM ${qualifiedCollection} WHERE id = $1 LIMIT 1`;
          const lookupResult = await this._executeQuery(lookupQuery, [idValue]);

          if (lookupResult.length > 0) {
            orderValue = lookupResult[0][validatedOrderByForCursor];
            // Convert to string for consistent handling
            if (orderValue instanceof Date) {
              orderValue = orderValue.toISOString();
            } else if (orderValue !== null && orderValue !== undefined) {
              orderValue = String(orderValue);
            }
          }
        } catch (err) {
          this._log('warn', `Failed to lookup sort value for cursor ID ${idValue}`, { error: err.message });
        }
      }

      if (idValue !== undefined) {
        // Handle NULLs in comparison:
        // For DESC (operator '<'), NULLs (infinity) should be at the start.
        // For ASC (operator '>'), NULLs (infinity) should be at the end.
        // Postgres default for NULLS LAST:
        //   ASC: NULL is +infinity
        //   DESC: NULL is +infinity

        const nullSentinel = options.order === 'asc' ? "'infinity'" : "'infinity'";
        const coalescedField = `COALESCE(${validatedOrderByForCursor}::text, ${nullSentinel})`;

        if (orderValue === undefined || orderValue === null || orderValue === 'null') {
          orderValue = 'infinity';
        }

        // Detect if orderValue looks like an ISO date string
        const isIsoDate = typeof orderValue === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(orderValue);

        params.push(orderValue, orderValue, idValue);

        let p1 = `$${paramCount++}`;
        let p2 = `$${paramCount++}`;
        let p3 = `$${paramCount++}`;

        if (isIsoDate && orderValue !== 'infinity') {
          p1 = `(${p1}::timestamptz)::text`;
          p2 = `(${p2}::timestamptz)::text`;
        }

        whereClauses.push(`((${coalescedField} ${operator} ${p1}) OR
                           (${coalescedField} = ${p2} AND id ${operator} ${p3}))`);
      }
    }

    // Build full query
    const qualifiedCollection = this._getCollectionName(options.collection);
    let query = `SELECT * FROM ${qualifiedCollection}`

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ')
    }

    // Always include ID as a tie-breaker for deterministic ordering (stable pagination)
    // Validate orderBy to prevent SQL injection and invalid column names
    let validatedOrderBy = options.orderBy;
    // Check if the value is actually the NaN constant, or the string 'nan'/'NaN', or if it's not a valid string
    if (!validatedOrderBy ||
      typeof validatedOrderBy !== 'string' ||
      String(validatedOrderBy).toLowerCase() === 'nan' ||
      (typeof validatedOrderBy === 'number' && isNaN(validatedOrderBy)) ||
      validatedOrderBy.trim() === '') {
      validatedOrderBy = 'id'; // Default to 'id' if orderBy is invalid
    }

    // Basic validation to ensure the orderBy field is a valid identifier
    // Only allow alphanumeric characters, underscore, and dot for schema qualification
    const isValidIdentifier = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(validatedOrderBy);
    if (!isValidIdentifier) {
      validatedOrderBy = 'id'; // Fallback to 'id' if not a valid identifier
    }

    const sortOrder = options.order === 'asc' ? 'ASC' : 'DESC'
    query += ` ORDER BY ${validatedOrderBy} ${sortOrder}, id ${sortOrder}`

    // Soporte para paginación con offset (tradicional)
    const limit = parseInt(options.limit) || 1000;
    const offset = parseInt(options.offset) || 0;

    if (offset > 0) {
      query += ` OFFSET ${offset}`
      query += ` LIMIT ${limit}`
    } else {
      // Paginación basada en cursor (original)
      query += ` LIMIT ${limit + 1}` // Fetch +1 to detect hasMore
    }

    this._log('debug', 'Executing query', { query, params })

    let data = await this._executeQuery(query, params)

    this._log('debug', 'Query executed', {
      collection: options.collection,
      returned: data.length,
      hasMore: data.length > options.limit
    })

    // Parse JSON fields in the returned data
    data = data.map(row => {
      const newRow = { ...row };
      for (const [key, value] of Object.entries(newRow)) {
        // Attempt to parse JSON strings back to objects/arrays
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            // Only replace if it's a valid JSON object/array
            if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
              newRow[key] = parsed;
            }
          } catch (e) {
            // If parsing fails, leave the value as-is (it wasn't JSON)
            // This is expected for regular string fields
          }
        }
      }
      return newRow;
    });

    return data
  }

  /**
   * Query with includes (related data)
   */
  async findWithIncludes(options) {
    const docs = await this.find(options)

    if (!options.include?.length || docs.length === 0) {
      return docs
    }

    // Warn if depth > 1
    if (options.depth && options.depth > 1) {
      this._log('warn', `depth=${options.depth} requested but only depth=1 is supported`)
    }

    // Resolve includes (one level only)
    for (const relatedCollection of options.include) {
      this._log('debug', `Resolving include: ${relatedCollection}`)

      // Determine foreign key (following convention)
      const singularCollection = relatedCollection.endsWith('s')
        ? relatedCollection.slice(0, -1)
        : relatedCollection
      const foreignKey = `${singularCollection}_id`

      // Collect all foreign key values
      const foreignIds = [...new Set(
        docs
          .map(doc => doc[foreignKey])
          .filter(id => id != null)
      )]

      if (foreignIds.length === 0) {
        this._log('debug', `No foreign keys found for ${relatedCollection}`)
        continue
      }

      // Fetch related documents
      const placeholders = foreignIds.map((_, i) => `$${i + 1}`).join(', ')
      const qualifiedRelated = this._getCollectionName(relatedCollection)
      const relatedQuery = `SELECT * FROM ${qualifiedRelated} WHERE id IN (${placeholders})`

      let relatedDocs = await this._executeQuery(relatedQuery, foreignIds)

      // Parse JSON fields in the related data
      relatedDocs = relatedDocs.map(row => {
        const newRow = { ...row };
        for (const [key, value] of Object.entries(newRow)) {
          // Attempt to parse JSON strings back to objects/arrays
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              // Only replace if it's a valid JSON object/array
              if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
                newRow[key] = parsed;
              }
            } catch (e) {
              // If parsing fails, leave the value as-is (it wasn't JSON)
              // This is expected for regular string fields
            }
          }
        }
        return newRow;
      });

      const relatedMap = Object.fromEntries(relatedDocs.map(doc => [doc.id, doc]))

      // Attach to parent documents
      for (const doc of docs) {
        const fkValue = doc[foreignKey]
        if (fkValue && relatedMap[fkValue]) {
          doc[relatedCollection] = relatedMap[fkValue]
        }
      }
    }

    return docs
  }

  /**
   * Get single document by ID
   */
  async getById(collection, id) {
    const qualifiedCollection = this._getCollectionName(collection)
    const query = `SELECT * FROM ${qualifiedCollection} WHERE id = $1 LIMIT 1`
    const result = await this._executeQuery(query, [id])

    if (result.length === 0) {
      return null;
    }

    // Parse JSON fields in the returned data
    const row = result[0];
    const newRow = { ...row };
    for (const [key, value] of Object.entries(newRow)) {
      // Attempt to parse JSON strings back to objects/arrays
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          // Only replace if it's a valid JSON object/array
          if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
            newRow[key] = parsed;
          }
        } catch (e) {
          // If parsing fails, leave the value as-is (it wasn't JSON)
          // This is expected for regular string fields
        }
      }
    }

    return newRow;
  }

  /**
   * Create new document
   */
  async create(collection, data) {
    // Normalizar datos: Si no hay 'id' pero hay 'uid', usar uid como id
    // Esto es necesario para compatibilidad con Firebase donde uid es el document ID
    const normalizedData = { ...data }

    if (!normalizedData.id && normalizedData.uid) {
      normalizedData.id = normalizedData.uid
    }

    // Si no hay ID, generar un UUID automáticamente
    if (!normalizedData.id) {
      // Importar uuid solo cuando sea necesario
      const { v4: uuidv4 } = await import('uuid');
      normalizedData.id = uuidv4();
    }

    // Guardar las claves originales para restaurar el casing después
    const originalKeys = Object.keys(normalizedData);

    // Normalizar nombres de columnas a minúsculas para compatibilidad con PostgreSQL
    // PostgreSQL trata los identificadores sin comillas como case-insensitive (convertidos a minúsculas)
    // Al citar con comillas dobles, se vuelven case-sensitive, por lo que normalizamos aquí
    const normalizedKeys = originalKeys.map(k => k.toLowerCase())
    let values = Object.values(normalizedData)

    // Process values to handle JSON fields properly
    values = values.map(value => {
      // If the value is an object or array, convert it to JSON string for PostgreSQL
      if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
      }
      return value;
    })

    const placeholders = normalizedKeys.map((_, i) => `$${i + 1}`).join(', ')
    const qualifiedCollection = this._getCollectionName(collection)

    const query = `
      INSERT INTO ${qualifiedCollection} (${normalizedKeys.map(k => `"${k}"`).join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `

    const result = await this._executeQuery(query, values)

    if (result.length === 0) {
      return null;
    }

    // Parse JSON fields and restore original key casing
    const parsedRow = this._parseJsonFields(result[0]);
    return this._restoreKeyCasing(parsedRow, originalKeys);
  }

  /**
   * Update document
   */
  async update(collection, id, data) {
    // Guardar las claves originales para restaurar el casing después
    const originalKeys = Object.keys(data);

    // Normalizar nombres de columnas a minúsculas para compatibilidad con PostgreSQL
    const normalizedKeys = originalKeys.map(k => k.toLowerCase())
    let values = Object.values(data)

    // Process values to handle JSON fields properly
    values = values.map(value => {
      // If the value is an object or array, convert it to JSON string for PostgreSQL
      if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
      }
      return value;
    });

    const setClause = normalizedKeys.map((key, i) => `"${key}" = $${i + 1}`).join(', ')
    const qualifiedCollection = this._getCollectionName(collection)

    const query = `
      UPDATE ${qualifiedCollection}
      SET ${setClause}
      WHERE id = $${normalizedKeys.length + 1}
      RETURNING *
    `

    const result = await this._executeQuery(query, [...values, id])

    if (result.length === 0) {
      return null;
    }

    // Parse JSON fields and restore original key casing
    const parsedRow = this._parseJsonFields(result[0]);
    return this._restoreKeyCasing(parsedRow, originalKeys);
  }

  /**
   * Delete document
   */
  async delete(collection, id) {
    const qualifiedCollection = this._getCollectionName(collection)
    const query = `DELETE FROM ${qualifiedCollection} WHERE id = $1`
    await this._executeQuery(query, [id])
  }

  /**
   * Count documents matching filters and search
   */
  async count(arg1, arg2) {
    let options = arg1;
    if (typeof arg1 === 'string') {
      options = { ...arg2, collection: arg1 };
    }

    const whereClauses = []
    const params = []
    let paramCount = 1

    // Apply structured 'where'
    if (options.where && Array.isArray(options.where)) {
      const opMap = { '==': '=', '!=': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };
      for (const cond of options.where) {
        if (!cond.field || !cond.operator || cond.value === undefined) continue;

        // Validate field name to prevent SQL injection
        if (!this._isValidFieldName(cond.field)) {
          this._log('warn', `Invalid field name in where clause: ${cond.field}`, { cond });
          continue; // Skip this condition
        }

        const sqlOp = opMap[cond.operator] || '=';
        if (cond.value === null) {
          if (cond.operator === '==' || cond.operator === '=') whereClauses.push(`${cond.field} IS NULL`);
          else if (cond.operator === '!=' || cond.operator === '<>') whereClauses.push(`${cond.field} IS NOT NULL`);
        } else {
          whereClauses.push(`${cond.field} ${sqlOp} $${paramCount++}`);
          params.push(cond.value);
        }
      }
    }

    this._applyFilters(whereClauses, params, options, paramCount)

    // Build count query
    const qualifiedCollection = this._getCollectionName(options.collection);
    let query = `SELECT COUNT(*) as total FROM ${qualifiedCollection}`

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ')
    }

    const result = await this._executeQuery(query, params)
    return parseInt(result[0].total)
  }

  /**
   * Run operations within a database transaction
   * Provides isolation and atomicity for multiple operations
   *
   * @param {Function} callback - Async function receiving transaction helper object
   * @returns {Promise<any>} Result from the callback
   *
   * @example
   * await reader.runTransaction(async (trx) => {
   *   const existing = await trx.find('users', { where: [...] });
   *   if (existing.length === 0) {
   *     await trx.create('users', { name: 'John' });
   *   }
   * });
   */
  async runTransaction(callback) {
    // Delegate to the database adapter if it supports transactions
    if (this.db && typeof this.db.runTransaction === 'function') {
      return await this.db.runTransaction(callback);
    }

    // Fallback: run without transaction if adapter doesn't support it
    // This maintains compatibility but without ACID guarantees
    console.warn('[PostgresReader] Transaction not supported by adapter, running without transaction');
    return await callback(this);
  }


  /**
   * Parse JSON fields in a row
   * @private
   */
  _parseJsonFields(row) {
    if (!row) return null;

    const newRow = { ...row };
    for (const [key, value] of Object.entries(newRow)) {
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) {
            newRow[key] = parsed;
          }
        } catch (e) {
          // Not JSON, leave as-is
        }
      }
    }
    return newRow;
  }

  /**
   * Restore original key casing from a result row
   * PostgreSQL returns lowercase keys, but we need to preserve the original casing
   * @param {Object} row - The row with lowercase keys from PostgreSQL
   * @param {string[]} originalKeys - The original keys with their casing
   * @returns {Object} Row with original key casing restored
   * @private
   */
  _restoreKeyCasing(row, originalKeys) {
    if (!row || !originalKeys) return row;

    // Create a map from lowercase to original casing
    const keyMap = {};
    for (const key of originalKeys) {
      keyMap[key.toLowerCase()] = key;
    }

    const restoredRow = {};
    for (const [lowercaseKey, value] of Object.entries(row)) {
      // Use original casing if available, otherwise keep lowercase
      const originalKey = keyMap[lowercaseKey] || lowercaseKey;
      restoredRow[originalKey] = value;
    }

    return restoredRow;
  }

  /**
   * Close database connections
   * Note: Delegates to the database adapter for cleanup
   */
  async close() {
    if (this.db && typeof this.db.close === 'function') {
      await this.db.close();
    }
  }

  /**
   * Get database statistics for monitoring
   */
  getStats() {
    // Use the database adapter to get stats
    if (this.db && typeof this.db.getStats === 'function') {
      return this.db.getStats();
    }
    return {};
  }
}
