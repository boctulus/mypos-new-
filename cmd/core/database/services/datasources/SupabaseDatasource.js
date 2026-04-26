import { DatasourceStrategy } from './Datasource-Strategy.js';
import { PostgresReader } from '../../libs/readers/PostgresReader.js';
import databasesConfig from '../../../../config/databases.config.js';
import DatabaseFactory from '../../DatabaseFactory.js';

export class SupabaseDatasource extends DatasourceStrategy {
    constructor(model) {
        super();
        this.model = model;
        this.entity = model.entity;

        // Configuración específica de Supabase
        const pgConfig = databasesConfig.db_connections.main;

        // Crear adapter usando la fábrica
        // Solo pasar parámetros válidos para la conexión, no el schema
        const dbAdapter = DatabaseFactory.create({
            host: pgConfig.host,
            port: pgConfig.port,
            user: pgConfig.user,
            password: pgConfig.pass,
            database: pgConfig.db_name,
            driver: 'pgsql'
        });

        // Pasar el adapter al lector
        this.reader = new PostgresReader(dbAdapter, {
            host: pgConfig.host,
            port: pgConfig.port,
            user: pgConfig.user,
            password: pgConfig.pass,
            database: pgConfig.db_name,
            schema: pgConfig.schema || 'public'
        });
    }

    /**
     * Close the underlying database connection pool
     */
    async close() {
        // Connection pools are managed by the reader's pool manager
        // Individual readers handle their own pool management
        if (this.reader && typeof this.reader.close === 'function') {
            await this.reader.close();
        }
    }

    /**
     * Get pool statistics for monitoring
     */
    getPoolStats() {
        // Use the central connection manager to get stats for all pools
        return PgSQLAdapter.getStats();
    }

    /**
     * Returns a query builder for PostgreSQL/Supabase
     * Provides a fluent API similar to Firebase's CollectionReference
     *
     * @returns {Object} Query builder with .where(), .orderBy(), .limit(), .get() methods
     */
    getQueryBuilder() {
        const reader = this.reader;
        const entity = this.entity;
        const model = this.model;

        // Fluent query builder that mimics Firebase API
        const builder = {
            _conditions: [],
            _orderBy: null,
            _orderDirection: 'asc',
            _limitValue: null,

            where(field, operator, value) {
                this._conditions.push({ field, operator, value });
                return this;
            },

            orderBy(field, direction = 'asc') {
                this._orderBy = field;
                this._orderDirection = direction;
                return this;
            },

            limit(count) {
                this._limitValue = count;
                return this;
            },

            async get() {
                const options = {
                    where: this._conditions,
                    orderBy: this._orderBy,
                    order: this._orderDirection,
                    limit: this._limitValue
                };

                // Add tenant filter if configured
                if (model.tenantId && !model.useTenantSubcollections) {
                    options.where.push({
                        field: model.tenantField || 'store_id',
                        operator: '==',
                        value: model.tenantId
                    });
                }

                let results = await reader.find(entity, options);

                // PostgresReader returns limit+1 to detect hasMore, trim to actual limit
                if (this._limitValue && results.length > this._limitValue) {
                    results = results.slice(0, this._limitValue);
                }

                // Return Firebase-like snapshot object
                return {
                    empty: results.length === 0,
                    size: results.length,
                    docs: results.map(doc => ({
                        id: doc.id,
                        data: () => doc,
                        exists: true
                    })),
                    forEach(callback) {
                        this.docs.forEach(callback);
                    }
                };
            }
        };

        return builder;
    }

    // Helper para construir WHERE clause para tenant
    _buildWhereWithTenant(options = {}) {
        const where = options.where || [];

        // Agregar condición de tenant si está configurado
        if (this.model.tenantId && !this.model.useTenantSubcollections) {
            where.push({
                field: this.model.tenantField || 'store_id',
                operator: '==',
                value: this.model.tenantId
            });
        }

        return { ...options, where };
    }

    async create(data, context) {
        // 1. Validar datos únicos antes de crear
        if (this.model.uniqueFields && this.model.uniqueFields.length > 0) {
            for (const field of this.model.uniqueFields) {
                const value = data[field];
                if (value) {
                    const existing = await this.reader.find(this.entity, {
                        where: [{ field, operator: '==', value }],
                        limit: 1
                    });
                    if (existing.length > 0) {
                        throw new Error(`Duplicate entry for field '${field}' with value '${value}'`);
                    }
                }
            }
        }

        // 2. Agregar timestamps
        const now = new Date().toISOString();
        const enrichedData = {
            ...data,
            created_at: now,
            updated_at: now
        };

        // 3. Crear
        const result = await this.reader.create(this.entity, enrichedData);

        // 4. Sync con Typesense si está habilitado
        await this._syncToTypesense('create', result, result.id);

        return result;
    }

    async update(data, context) {
        const id = data[this.model.idField];
        if (!id) {
            throw new Error(`Update error: Missing required identifier "${this.model.idField}"`);
        }

        // Preparar datos para actualización
        const updateData = { ...data };
        delete updateData[this.model.idField]; // No actualizar el ID

        // Agregar timestamp de actualización
        updateData.updated_at = new Date().toISOString();

        const result = await this.reader.update(this.entity, id, updateData);

        // Sync con Typesense
        await this._syncToTypesense('update', result, id);

        return result;
    }

    async upsert(data, context) {
        // Usar UPSERT nativo de PostgreSQL si está disponible
        // Para simplificar, usamos create y capturamos error de duplicado
        try {
            return await this.create(data, context);
        } catch (error) {
            if (error.message.includes('duplicate') || error.message.includes('unique')) {
                // Si es error de duplicado, hacer update
                const idField = this.model.idField;
                let id = data[idField];

                // Si no hay ID en los datos, buscar por campos únicos
                if (!id && this.model.uniqueFields) {
                    for (const field of this.model.uniqueFields) {
                        const value = data[field];
                        if (value) {
                            const existing = await this.reader.find(this.entity, {
                                where: [{ field, operator: '==', value }],
                                limit: 1
                            });
                            if (existing.length > 0) {
                                id = existing[0][idField] || existing[0].id;
                                break;
                            }
                        }
                    }
                }

                if (id) {
                    const updateData = { ...data, [idField]: id };
                    return await this.update(updateData, context);
                }
            }
            throw error;
        }
    }

    async delete(id, context) {
        // Verificar si existe
        const existing = await this.getById(id, context);
        if (!existing) {
            throw new Error(`Document ${id} not found in ${this.entity}`);
        }

        await this.reader.delete(this.entity, id);

        // Sync con Typesense
        await this._syncToTypesense('delete', null, id);

        return { id, success: true, deletedData: existing };
    }

    async softDelete(id, context) {
        const updateData = {
            deleted_at: new Date().toISOString()
        };
        return await this.reader.update(this.entity, id, updateData);
    }

    async getById(id, context) {
        const options = this._buildWhereWithTenant(context);
        return this.reader.getById(this.entity, id, options);
    }

    async findWhere(options, context) {
        const mergedOptions = this._buildWhereWithTenant({ ...options, ...context });
        return this.reader.find(this.entity, mergedOptions);
    }

    async count(options, context) {
        const mergedOptions = this._buildWhereWithTenant({ ...options, ...context });
        return this.reader.count(this.entity, mergedOptions);
    }

    async list(options = {}, context) {
        return this.findWhere(options, context);
    }

    async listPaginated(options, context) {
        const mergedOptions = this._buildWhereWithTenant({ ...options, ...context });
        return this.reader.read(this.entity, mergedOptions);
    }

    async listByTenantId(tenantId, includeNull, context) {
        // Construir condición OR para tenantId o null
        const conditions = [{ field: this.model.tenantField, operator: '==', value: tenantId }];

        if (includeNull) {
            conditions.push({ field: this.model.tenantField, operator: '==', value: null });
        }

        // PostgresReader necesita soporte para OR, pero actualmente solo hace AND
        // Para ahora, hacemos dos queries y combinamos
        const [docsWithTenant, docsNull] = await Promise.all([
            this.reader.find(this.entity, {
                where: [conditions[0]],
                ...context
            }),
            includeNull ? this.reader.find(this.entity, {
                where: [conditions[1]],
                ...context
            }) : Promise.resolve([])
        ]);

        const result = [...docsWithTenant];
        if (includeNull) {
            const styledNulls = docsNull.map(r => ({ ...r, readonly: true }));
            result.push(...styledNulls);
        }

        return result;
    }

    async get(options, context) {
        const mergedOptions = this._buildWhereWithTenant({
            ...options,
            limit: 1,
            ...context
        });
        const results = await this.reader.find(this.entity, mergedOptions);
        return results[0] || null;
    }

    async getAll(options, context) {
        return this.findWhere(options, context);
    }

    async read(options, context) {
        const mergedOptions = this._buildWhereWithTenant({ ...options, ...context });
        return this.reader.read(this.entity, mergedOptions);
    }

    // _syncToTypesense inherited from base class (DatasourceStrategy)
    // Supabase uses default collection naming (no tenant-based naming)

    /**
     * Run operations within a database transaction
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
        const entity = this.entity;
        const model = this.model;

        return await this.reader.runTransaction(async (trx) => {
            // Wrap the transaction helper to use entity automatically
            const wrappedTrx = {
                /**
                 * Find documents within transaction
                 */
                find: async (options = {}) => {
                    const mergedOptions = this._buildWhereWithTenant(options);
                    return await trx.find(entity, mergedOptions);
                },

                /**
                 * Get document by ID within transaction
                 */
                getById: async (id) => {
                    return await trx.getById(entity, id);
                },

                /**
                 * Create document within transaction
                 */
                create: async (data) => {
                    const now = new Date().toISOString();
                    const enrichedData = {
                        ...data,
                        created_at: now,
                        updated_at: now
                    };
                    return await trx.create(entity, enrichedData);
                },

                /**
                 * Update document within transaction
                 */
                update: async (id, data) => {
                    const updateData = {
                        ...data,
                        updated_at: new Date().toISOString()
                    };
                    return await trx.update(entity, id, updateData);
                },

                /**
                 * Delete document within transaction
                 */
                delete: async (id) => {
                    return await trx.delete(entity, id);
                }
            };

            return await callback(wrappedTrx);
        });
    }
}