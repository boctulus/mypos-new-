import { DatasourceStrategy } from './Datasource-Strategy.js';
import FirestoreReader from '../../libs/readers/FirestoreReader.js';
import TypesenseClient from '../../libs/TypesenseClient.js';
import DuplicateEntryError from '../../../errors/DuplicateEntryError.js';

export class FirebaseDatasource extends DatasourceStrategy {
  constructor(model) {
    super();
    this.model = model;
    this.db = model.db;
    this.reader = new FirestoreReader(this.db);
  }

  /**
   * Returns the Firestore collection reference for direct query building
   * Similar to Laravel's DB::table('table')
   *
   * @returns {CollectionReference} Firestore collection reference with fluent API (.where, .orderBy, .limit, .get)
   * @throws {Error} If database is not initialized
   */
  getQueryBuilder() {
    if (!this.db) {
      throw new Error('Firebase database not initialized');
    }

    const entity = this.model.entity;

    // Handle tenant subcollections
    if (this.model.useTenantSubcollections && this.model.tenantId) {
      return this.db.collection('stores').doc(this.model.tenantId).collection(entity);
    }

    return this.db.collection(entity);
  }

  // Helper to build options expected by FirestoreReader
  _buildOptions(context) {
    return {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      uniqueFields: this.model.uniqueFields,
      // Add other context options if necessary
      ...context
    };
  }

  async create(data, context) {
    const options = this._buildOptions(context);

    // FirestoreReader.create handles uniqueness and transactions
    const result = await this.reader.create(this.model.entity, data, options);

    // Sync to Typesense
    await this._syncToTypesense('create', result, result.id);

    return result;
  }

  async update(data, context) {
    const options = this._buildOptions(context);
    const id = data[this.model.idField];

    if (!id) {
      throw new Error(`Update error: Missing required identifier "${this.model.idField}"`);
    }

    const result = await this.reader.update(this.model.entity, id, data, options);

    await this._syncToTypesense('update', result, id);

    return result;
  }

  async delete(id, context) {
    const options = this._buildOptions(context);

    await this.reader.delete(this.model.entity, id, options);

    await this._syncToTypesense('delete', null, id);

    return { id, success: true };
  }

  async softDelete(id, context) {
    // Logic for soft delete: Update deleted_at
    const options = this._buildOptions(context);
    // Soft delete is essentially an update
    const updateData = {
      deleted_at: new Date() // FirestoreReader will likely handle formatting or we pass Date
    };

    // We use reader.update. Reader handles timestamp conversion if it uses FieldValue.serverTimestamp()
    // But here we might want to be specific.
    // FirestoreReader update uses FieldValue.serverTimestamp() for updated_at.
    // Let's pass deleted_at.

    const result = await this.reader.update(this.model.entity, id, updateData, options);

    await this._syncToTypesense('upsert', result, id); // update typesense to reflect soft delete

    return result;
  }

  async upsert(data, context) {
    const options = this._buildOptions(context);

    // Check unique fields first to find existing record
    if (this.model.uniqueFields && this.model.uniqueFields.length > 0) {
      for (const field of this.model.uniqueFields) {
        const value = data[field];
        if (value !== undefined && value !== null && value !== '') {
          try {
            const searchOptions = {
              ...options,
              where: [{ field, operator: '==', value }],
              limit: 1
            };
            const existingRecords = await this.reader.find(this.model.entity, searchOptions);

            if (existingRecords.length > 0) {
              const existingId = existingRecords[0][this.model.idField] || existingRecords[0].id;
              const updateData = { ...data, [this.model.idField]: existingId };
              return await this.update(updateData, context);
            }
          } catch (e) {
            // Continue checking other unique fields
          }
        }
      }
    }

    // If no ID and no unique field match, try to create
    try {
      return await this.create(data, context);
    } catch (error) {
      // 🔧 FIX: Handle race condition - if duplicate error, retry with update
      if (error instanceof DuplicateEntryError) {
        // Try to find the existing record again (race condition scenario)
        if (this.model.uniqueFields && this.model.uniqueFields.length > 0) {
          for (const field of this.model.uniqueFields) {
            const value = data[field];
            if (value !== undefined && value !== null && value !== '') {
              try {
                const searchOptions = {
                  ...options,
                  where: [{ field, operator: '==', value }],
                  limit: 1
                };
                const existingRecords = await this.reader.find(this.model.entity, searchOptions);

                if (existingRecords.length > 0) {
                  const existingId = existingRecords[0][this.model.idField] || existingRecords[0].id;
                  const updateData = { ...data, [this.model.idField]: existingId };
                  return await this.update(updateData, context);
                }
              } catch (e) {
                // Continue to next field
              }
            }
          }
        }
      }
      throw error;
    }
  }

  async read(options = {}) {
    // Delegate to reader's unified read
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    return this.reader.read(this.model.entity, opts);
  }

  async getById(id, context) {
    const options = this._buildOptions(context);
    return this.reader.getById(this.model.entity, id, options);
  }

  async get(options, context) {
    // Single doc find
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    // Reuse reader.find but limit 1
    const results = await this.reader.find(this.model.entity, { ...opts, limit: 1 });
    return results.length ? results[0] : null;

  }



  async list(options = {}, context) {
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    return this.reader.find(this.model.entity, opts);
  }

  async listPaginated(options, context) {
    // Delegate to read which behaves like listPaginated in unified interface
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    return this.reader.read(this.model.entity, opts);
  }

  async listByTenantId(tenantId, includeNull, context) {
    // Delegating to reader.find with specific logic
    // FirestoreReader doesn't have listByTenantId specific logic but has logic to switch collections?
    // Wait, listByTenantId in Model.js was:
    // collectionRef.where(tenantField, '==', tenantId)
    // This implies the collection is NOT subcollection-based for this query, OR logic differs.
    // Actually, if useTenantSubcollections is true, data IS partitioned.
    // But listByTenantId suggests querying BY field.

    // Use standard find with where clause
    const where = [{ field: this.model.tenantField, operator: '==', value: tenantId }];

    const results = await this.reader.find(this.model.entity, {
      ...context,
      where,
      // Force standard collection query if needed? 
      // If useTenantSubcollections is is true, _getCollectionRef in reader handles it using options.tenantId.
      // If we want to list by tenantId, we probably set options.tenantId = tenantId.
      tenantId: tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections
    });

    if (includeNull) {
      const nullResults = await this.reader.find(this.model.entity, {
        ...context,
        where: [{ field: this.model.tenantField, operator: '==', value: null }],
        useTenantSubcollections: this.model.useTenantSubcollections
      });
      // Mark readonly
      const styledNulls = nullResults.map(r => ({ ...r, readonly: true }));
      return [...results, ...styledNulls];
    }

    return results;
  }

  async findWhere(options, context) {
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    return this.reader.find(this.model.entity, opts);
  }

  async count(options, context) {
    const opts = {
      tenantId: this.model.tenantId,
      useTenantSubcollections: this.model.useTenantSubcollections,
      ...options
    };
    return this.reader.count(this.model.entity, opts);
  }

  /**
   * Firebase uses tenant-specific collections for Typesense when useTenantSubcollections is enabled
   */
  _getTypesenseCollectionName() {
    const appPrefix = process.env.APP_NAME ? `${process.env.APP_NAME}_` : '';

    if (this.model.useTenantSubcollections && this.model.tenantId) {
      return `${appPrefix}${this.model.entity}_${this.model.tenantId}`;
    }

    return `${appPrefix}${this.model.entity}`;
  }

  // _syncToTypesense inherited from base class (DatasourceStrategy)

  /**
   * Run operations within a Firestore transaction
   * Provides atomicity and isolation for multiple operations
   *
   * @param {Function} callback - Async function receiving transaction helper
   * @returns {Promise<any>} Result from the callback
   *
   * @example
   * await model.runTransaction(async (trx) => {
   *   const existing = await trx.find({ where: [...] });
   *   if (existing.length === 0) {
   *     await trx.create({ name: 'John' });
   *   }
   * });
   */
  async runTransaction(callback) {
    const db = this.db;
    const entity = this.model.entity;
    const model = this.model;
    const collectionRef = this.getQueryBuilder();

    return await db.runTransaction(async (transaction) => {
      // Wrap the Firestore transaction to provide a consistent API
      const wrappedTrx = {
        /**
         * Find documents within transaction (uses transaction.get)
         */
        find: async (options = {}) => {
          let query = collectionRef;

          // Apply where conditions
          if (options.where && Array.isArray(options.where)) {
            for (const cond of options.where) {
              const operator = cond.operator === '==' ? '==' : cond.operator;
              query = query.where(cond.field, operator, cond.value);
            }
          }

          // Apply limit
          if (options.limit) {
            query = query.limit(options.limit);
          }

          const snapshot = await transaction.get(query);
          return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },

        /**
         * Get document by ID within transaction
         */
        getById: async (id) => {
          const docRef = collectionRef.doc(id);
          const doc = await transaction.get(docRef);
          return doc.exists ? { id: doc.id, ...doc.data() } : null;
        },

        /**
         * Create document within transaction
         */
        create: async (data) => {
          const now = new Date().toISOString();
          const enrichedData = {
            ...data,
            created_at: now,
            updated_at: now,
            deleted_at: null
          };

          const newDocRef = collectionRef.doc();
          transaction.set(newDocRef, enrichedData);
          return { id: newDocRef.id, ...enrichedData };
        },

        /**
         * Update document within transaction
         */
        update: async (id, data) => {
          const docRef = collectionRef.doc(id);
          const updateData = {
            ...data,
            updated_at: new Date().toISOString()
          };
          transaction.update(docRef, updateData);
          return { id, ...updateData };
        },

        /**
         * Delete document within transaction
         */
        delete: async (id) => {
          const docRef = collectionRef.doc(id);
          transaction.delete(docRef);
        },

        /**
         * Set document within transaction (for backwards compatibility)
         */
        set: (docRef, data) => {
          transaction.set(docRef, data);
        },

        /**
         * Get raw Firestore transaction for advanced use cases
         */
        getFirestoreTransaction: () => transaction,

        /**
         * Get collection reference for advanced queries
         */
        getCollectionRef: () => collectionRef
      };

      return await callback(wrappedTrx);
    });
  }

}