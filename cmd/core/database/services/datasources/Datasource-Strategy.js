/**
 * Interface for datasource strategies
 * Defines the contract for all database operations
 */
export class DatasourceStrategy {
  /**
   * Creates a new record
   * @param {Object} data - The data to create
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The created record
   */
  async create(data, context) {
    throw new Error('Method create() must be implemented');
  }

  /**
   * Updates an existing record
   * @param {Object} data - The data to update
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The updated record
   */
  async update(data, context) {
    throw new Error('Method update() must be implemented');
  }

  /**
   * Deletes a record
   * @param {string} id - The ID of the record to delete
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The deletion result
   */
  async delete(id, context) {
    throw new Error('Method delete() must be implemented');
  }

  /**
   * Gets a record by ID
   * @param {string} id - The ID of the record to get
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The retrieved record
   */
  async getById(id, context) {
    throw new Error('Method getById() must be implemented');
  }

  /**
   * Lists records
   * @param {Object} options - Query options
   * @param {Object} context - Operation context
   * @returns {Promise<Array>} The list of records
   */
  async list(options, context) {
    throw new Error('Method list() must be implemented');
  }

  /**
   * Finds records matching conditions
   * @param {Object} options - Query options
   * @param {Object} context - Operation context
   * @returns {Promise<Array>} The list of matching records
   */
  async findWhere(options, context) {
    throw new Error('Method findWhere() must be implemented');
  }

  /**
   * Counts records matching conditions
   * @param {Object} options - Query options
   * @param {Object} context - Operation context
   * @returns {Promise<number>} The count of matching records
   */
  async count(options, context) {
    throw new Error('Method count() must be implemented');
  }

  /**
   * Upserts a record (creates if doesn't exist, updates if exists)
   * @param {Object} data - The data to upsert
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The upserted record
   */
  async upsert(data, context) {
    throw new Error('Method upsert() must be implemented');
  }

  /**
   * Performs a soft delete (marks as deleted without removing)
   * @param {string} id - The ID of the record to soft delete
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The soft delete result
   */
  async softDelete(id, context) {
    throw new Error('Method softDelete() must be implemented');
  }

  /**
   * Lists records with pagination
   * @param {Object} options - Pagination options
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The paginated result
   */
  async listPaginated(options, context) {
    throw new Error('Method listPaginated() must be implemented');
  }

  /**
   * Lists records by tenant ID
   * @param {string} tenantId - The tenant ID
   * @param {boolean} includeNull - Whether to include records with null tenant
   * @param {Object} context - Operation context
   * @returns {Promise<Array>} The list of records
   */
  async listByTenantId(tenantId, includeNull, context) {
    throw new Error('Method listByTenantId() must be implemented');
  }

  /**
   * Gets a single record matching conditions
   * @param {Object} options - Query options
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The matching record or null
   */
  async get(options, context) {
    throw new Error('Method get() must be implemented');
  }

  /**
   * Gets all records matching conditions
   * @param {Object} options - Query options
   * @param {Object} context - Operation context
   * @returns {Promise<Array>} The list of matching records
   */
  async getAll(options, context) {
    throw new Error('Method getAll() must be implemented');
  }

  /**
   * Reads records with pagination and advanced options
   * @param {Object} options - Query and pagination options
   * @param {Object} context - Operation context
   * @returns {Promise<Object>} The paginated result with docs and metadata
   */
  async read(options, context) {
    throw new Error('Method read() must be implemented');
  }

  /**
   * Get Typesense collection name
   * Override in subclass if custom naming is needed (e.g., tenant-based collections)
   * @returns {string} The Typesense collection name
   */
  _getTypesenseCollectionName() {
    const appPrefix = process.env.APP_NAME ? `${process.env.APP_NAME}_` : '';
    return `${appPrefix}${this.model.entity}`;
  }

  /**
   * Sync data to Typesense
   * Shared logic for all datasources
   * @param {string} action - The sync action: 'create', 'update', 'upsert', or 'delete'
   * @param {Object} data - The data to sync (null for delete)
   * @param {string} docId - The document ID
   */
  async _syncToTypesense(action, data, docId) {
    if (!this.model.syncToTypesense) return;

    try {
      const transformed = await this.model.transformDataForTypesense(data);
      if (transformed === false) return;

      const ty_coll = this._getTypesenseCollectionName();
      const TypesenseClient = (await import('../../../../services/typesenseClient.js')).default;
      const typesenseCollection = TypesenseClient.collections(ty_coll).documents();

      switch (action) {
        case 'create':
          await typesenseCollection.create(transformed);
          break;
        case 'update':
        case 'upsert':
          await typesenseCollection.upsert(transformed);
          break;
        case 'delete':
          await typesenseCollection.delete(docId);
          break;
      }
    } catch (error) {
      console.error(`Typesense sync failed for ${action} in ${this.model.entity}:`, error.message);
      // Don't throw - avoid failing main operation
    }
  }
}