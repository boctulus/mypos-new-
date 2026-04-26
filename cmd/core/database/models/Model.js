import path from 'path';
import { pathToFileURL } from 'url';
import Strings from '../../libs/Strings.js';

import DuplicateEntryError from '../../errors/DuplicateEntryError.js';
import modelRegistry from '../../config/modelRegistry.js'; // Importa el registro de modelos
import databasesConfig from '../../../config/databases.config.js'; // Importa configuración de datasources
import {
  GenericTypeValidationAdapter,
  GenericSchemaAdapter,
  GenericTypesenseAdapter,
  AdapterFactory
} from '../services/datasources/adapters/index.js';

/*
    # Multitenancy

    Se implementan dos patrones de multi-tenancy:

    1. Subcolecciones por tenant (useTenantSubcollections = true)
    2. Campo de tenant en el documento (useTenantSubcollections = false)

    No pueden coexist en el mismo modelo (para la misma colección).

    # `FireORM` (an ORM wrapper for Firestore) y `fireschema`

    https://chatgpt.com/c/68a26a1f-cb88-8325-8a93-47e4d6b69c0d
    https://grok.com/chat/b869e9a7-60f0-45d8-8f52-01cd7f298eea
    https://chat.deepseek.com/a/chat/s/1dc851ce-dd62-4d82-bcee-cc68389c2b9a
*/
export default class Model {
  entity; // collection name in Firestore
  idField = 'id'; // Default ID field, can be overridden in subclasses
  useTenantSubcollections = false; // is multitenancy managed by subcollections?
  tenantId = null; // Almacenará el ID del tenant para esta instancia del modelo
  tenantField = 'store_id'; // Default tenant field, can be overridden in subclasses (this is different than subcollection approach)
  uniqueFields = []; // Array of unique fields, can be overridden in subclasses
  syncToTypesense = false;
  useTypesensePrefix = true; // Flag para controlar si usar APP_NAME prefix en Typesense
  schema = null; // Schema loaded dinamically
  enableSchemaValidation = true; // Flag para habilitar/deshabilitar validación
  datasource = null; // Datasource Strategy instance
  datasourceName = null; // 'firebase' | 'supabase'

  // Composition objects for datasource-specific functionality
  typeValidationAdapter = null;
  schemaAdapter = null;
  typesenseAdapter = null;

  // ============================================
  // NUEVO: Sistema de ubicaciones de modelos
  // ============================================
  static _modelLocations = new Map(); // Almacena ubicaciones personalizadas por modelo
  static _defaultModelPath = './models'; // Ruta por defecto (relativa a process.cwd())

  /**
   * Establece una ubicación personalizada para un modelo específico
   * @param {string} modelName - Nombre del modelo (ej: 'SystemLogsModel')
   * @param {string} customPath - Ruta personalizada relativa al proyecto
   * @example
   * Model.setModelLocation('SystemLogsModel', './modules/logs/models');
   */
  static setModelLocation(modelName, customPath) {
    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name must be a non-empty string');
    }
    if (!customPath || typeof customPath !== 'string') {
      throw new Error('Custom path must be a non-empty string');
    }

    this._modelLocations.set(modelName, customPath);
    console.log(`📍 Model location set: ${modelName} -> ${customPath}`);
  }

  /**
   * Obtiene la ubicación configurada para un modelo
   * @param {string} modelName - Nombre del modelo
   * @returns {string} Ruta del modelo (personalizada o por defecto)
   */
  static getModelLocation(modelName) {
    return this._modelLocations.get(modelName) || this._defaultModelPath;
  }

  /**
   * Limpia la ubicación personalizada de un modelo
   * @param {string} modelName - Nombre del modelo
   */
  static clearModelLocation(modelName) {
    const removed = this._modelLocations.delete(modelName);
    if (removed) {
      console.log(`🗑️ Model location cleared: ${modelName}`);
    }
    return removed;
  }

  /**
   * Limpia todas las ubicaciones personalizadas
   */
  static clearAllModelLocations() {
    this._modelLocations.clear();
    console.log('🗑️ All custom model locations cleared');
  }

  /**
   * Lista todas las ubicaciones personalizadas configuradas
   * @returns {Object} Mapa de modelos y sus ubicaciones
   */
  static listModelLocations() {
    return Object.fromEntries(this._modelLocations);
  }

  // Hooks system
  static _globalHooks = {
    beforeCreate: [],
    afterCreate: [],
    beforeUpdate: [],
    afterUpdate: [],
    beforeDelete: [],
    afterDelete: []
  };

  _instanceHooks = {
    beforeCreate: [],
    afterCreate: [],
    beforeUpdate: [],
    afterUpdate: [],
    beforeDelete: [],
    afterDelete: []
  };

  // Observer system
  static _globalObservers = new Set();
  _instanceObservers = new Set();

  constructor(db) {
    this.db = db;

    // Initialize adapters based on datasource
    this._initializeAdapters();

    // Load schema asynchronously if enabled
    if (this.enableSchemaValidation) {
      this._loadSchemaAsync();
    }

    // Note: _initializeDatasourceStrategy() will be called lazily by _getDatasource()
    // or manually by subclasses if needed. 
    // We remove it from constructor to avoid 'unknown' entity during init.

  }

  /**
   * Initializes the datasource strategy based on configuration
   * @private
   */
  async _initializeDatasourceStrategy() {
    const entityName = this.entity || 'unknown';

    // 1. Determine datasource name (prefer subclass setting)
    if (!this.datasourceName) {
      if (databasesConfig.modelDatasources && databasesConfig.modelDatasources[entityName]) {
        this.datasourceName = databasesConfig.modelDatasources[entityName];
      } else {
        this.datasourceName = databasesConfig.defaultModelDatasource || 'supabase';
      }
    }

    console.log(`📊 [${entityName}] Effective datasource: ${this.datasourceName}`);

    // 2. Initialize adapters based on datasource type
    this._initializeAdaptersByDatasource(this.datasourceName);

    // 3. Instantiate Strategy
    if (this.datasourceName === 'firebase') {
      // Lazy-load DB for Firebase if not already provided
      if (!this.db) {
        const FirebaseFactory = (await import('../services/factories/FirebaseFactory.js')).default;
        this.db = await FirebaseFactory.getDB();
        console.log(`📡 [${entityName}] Firebase DB initialized lazily`);
      }
      const { FirebaseDatasource } = await import('../services/datasources/FirebaseDatasource.js');
      this.datasource = new FirebaseDatasource(this);
    } else if (this.datasourceName === 'supabase') {
      const { SupabaseDatasource } = await import('../services/datasources/SupabaseDatasource.js');
      this.datasource = new SupabaseDatasource(this);
    } else {
      console.warn(`Unknown datasource: ${this.datasourceName}. Defaulting to Supabase.`);
      const { SupabaseDatasource } = await import('../services/datasources/SupabaseDatasource.js');
      this.datasource = new SupabaseDatasource(this);
    }
  }

  /**
   * Initializes the adapters for datasource-specific functionality
   * @private
   */
  _initializeAdapters() {
    // Use generic adapters by default
    this.typeValidationAdapter = new GenericTypeValidationAdapter();
    this.schemaAdapter = new GenericSchemaAdapter();
    this.typesenseAdapter = new GenericTypesenseAdapter();
  }

  /**
   * Initializes the adapters based on the datasource type
   * @private
   */
  _initializeAdaptersByDatasource(datasourceType) {
    this.typeValidationAdapter = AdapterFactory.createTypeValidationAdapter(datasourceType);
    this.schemaAdapter = AdapterFactory.createSchemaAdapter(datasourceType);
    this.typesenseAdapter = AdapterFactory.createTypesenseAdapter(datasourceType);
  }

  /**
   * Ensure datasource is ready
   */
  async _getDatasource() {
    if (!this.datasource) {
      await this._initializeDatasourceStrategy();
    }
    return this.datasource;
  }

  // =================================================================
  // COMPOSITION ADAPTER METHODS
  // =================================================================

  /**
   * Validates the type of a field value using the appropriate adapter
   * @param {*} value - The value to validate
   * @param {string} expectedType - The expected type
   * @returns {boolean} True if the value matches the expected type
   */
  _validateFieldType(value, expectedType) {
    return this.typeValidationAdapter.validateFieldType(value, expectedType);
  }

  /**
   * Gets the default value for a specific type using the appropriate adapter
   * @param {string} type - The type
   * @returns {*} The default value for the type
   */
  defaultForType(type) {
    return this.typeValidationAdapter.defaultForType(type);
  }

  /**
   * Casts a value to a specific type using the appropriate adapter
   * @param {*} value - The value to cast
   * @param {string} type - The target type
   * @returns {*} The cast value
   */
  castValue(value, type) {
    return this.typeValidationAdapter.castValue(value, type);
  }

  /**
   * Loads the schema for the model using the appropriate adapter
   * @private
   */
  async _loadSchema() {
    if (!this.enableSchemaValidation || !this.entity) {
      return;
    }

    try {
      const schema = await this.schemaAdapter.loadSchema(this.entity);
      this.schema = schema;
      console.log(`📋 Schema loaded for collection '${this.entity}'`);
    } catch (error) {
      console.warn(`⚠️ Schema not found for collection '${this.entity}': ${error.message}`);
      this.schema = null;
    }
  }

  /**
   * Loads the schema asynchronously without blocking the constructor
   */
  _loadSchemaAsync() {
    this._loadSchema().catch(error => {
      console.warn(`⚠️ Failed to load schema for '${this.entity}': ${error.message}`);
    });
  }

  /**
   * Validates data against the schema using the appropriate adapter
   * @param {Object} data - The data to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @returns {{valid: boolean, errors: Array<string>}} Validation result
   */
  _validateAgainstSchema(data, isUpdate = false) {
    if (!this.enableSchemaValidation || !this.schema) {
      return { valid: true, errors: [] };
    }

    return this.schemaAdapter.validateAgainstSchema(this.schema, data, isUpdate);
  }

  /**
   * Checks if soft delete is enabled in the schema using the appropriate adapter
   * @returns {boolean} True if soft delete is enabled
   */
  _isSoftDeleteEnabled() {
    if (!this.schema) {
      return false;
    }
    return this.schemaAdapter.isSoftDeleteEnabled(this.schema);
  }

  /**
   * Transforms data for Typesense using the appropriate adapter
   * @param {Object} data - The data to transform
   * @returns {Promise<Object|boolean>} The transformed data or false if schema not found
   */
  async transformDataForTypesense(data) {
    return this.typesenseAdapter.transformDataForTypesense(this, data);
  }

  /**
   * Synchronizes subcollections with Typesense using the appropriate adapter
   * @param {string} parentId - The parent document ID
   * @param {Object} parentData - The parent document data
   * @param {string} action - The action performed
   * @returns {Promise<void>}
   */
  async syncSubcollectionsWithTypesense(parentId, parentData, action) {
    return this.typesenseAdapter.syncSubcollectionsWithTypesense(this, parentId, parentData, action);
  }

  /*
    MÉTODO PARA SETEAR EL TENANT

    Parte de sistema multi-tenant basado en subcolecciones
  */
  setTenant(tenantId) {
    if (!this.useTenantSubcollections) { // <--- Opcional: añade un aviso
      console.warn(`⚠️ Warning: setTenant() called on model '${this.entity}' which is not configured as tenant-aware.`);
    }

    if (!tenantId) {
      throw new Error('Tenant ID cannot be null or empty.');
    }

    this.tenantId = tenantId;
    return this;
  }

  /**
   * Returns a query builder for the current entity
   * Delegates to the datasource's getQueryBuilder method
   * Similar to Laravel's DB::table('table')
   *
   * @returns {Promise<Object>} Query builder (CollectionReference for Firebase, QueryBuilder for Supabase)
   * @throws {Error} If datasource is not initialized
   */
  async getQueryBuilder() {
    const datasource = await this._getDatasource();

    if (!datasource.getQueryBuilder) {
      throw new Error(`getQueryBuilder() not implemented for datasource: ${this.datasourceName}`);
    }

    return datasource.getQueryBuilder();
  }

  /**
   * Run operations within a database transaction
   * Provides atomicity and isolation for multiple operations
   * Delegates to the datasource's runTransaction method
   *
   * @param {Function} callback - Async function receiving transaction helper object
   * @returns {Promise<any>} Result from the callback
   * @throws {Error} If datasource doesn't support transactions
   *
   * @example
   * // Check for existing session and create if not exists (atomic)
   * const result = await model.runTransaction(async (trx) => {
   *   const existing = await trx.find({
   *     where: [{ field: 'user_id', operator: '==', value: userId }]
   *   });
   *
   *   if (existing.length > 0) {
   *     return { existed: true, session: existing[0] };
   *   }
   *
   *   const newSession = await trx.create({ user_id: userId, status: 'open' });
   *   return { existed: false, session: newSession };
   * });
   */
  async runTransaction(callback) {
    const datasource = await this._getDatasource();

    if (!datasource.runTransaction) {
      throw new Error(`runTransaction() not implemented for datasource: ${this.datasourceName}`);
    }

    return datasource.runTransaction(callback);
  }

  /**
   * Infers model name from collection name
   */
  inferModelName(collectionName) {
    const name = collectionName.toLowerCase();
    return name.charAt(0).toUpperCase() + name.slice(1) + 'Model';
  }

  /**
   * Obtiene el nombre de la colección en Typesense
   */
  getTypesenseCollectionName() {
    const appPrefix = process.env.APP_NAME ? `${process.env.APP_NAME}_` : '';
    if (this.useTenantSubcollections && this.tenantId) {
      return `${appPrefix}${this.entity}_${this.tenantId}`;
    }
    return `${appPrefix}${this.entity}`;
  }

  /**
   * Carga un modelo dinámicamente, soportando ubicaciones personalizadas
   * @param {string} collectionName - Nombre de la colección
   * @param {string} tenantId - ID del tenant (opcional)
   * @returns {Promise<Model>} Instancia del modelo
   */
  static async loadModel(collectionName = null, tenantId = null) {
    let ModelName = 'Model';

    if (collectionName) {
      ModelName = modelRegistry[collectionName] ?? Strings.toPascalCase(collectionName) + 'Model';
    }

    // db will be lazy-loaded by the instance if needed
    const db = null;

    let modelInstance;

    if (ModelName && ModelName !== 'Model') {
      // Obtener la ubicación del modelo (personalizada o por defecto)
      const modelPath = this.getModelLocation(ModelName);

      try {
        // Intentar cargar desde la ubicación configurada
        const fullPath = path.resolve(process.cwd(), modelPath, `${ModelName}.js`);
        const modelUrl = pathToFileURL(fullPath).href;

        console.log(`📦 Loading model: ${ModelName} from ${modelPath}`);

        const ModelClass = (await import(modelUrl)).default;

        if (!ModelClass) {
          throw new Error(`Modelo ${ModelName} no encontrado en ${modelPath}`);
        }

        // Crear instancia
        modelInstance = new ModelClass(db);
        modelInstance.entity = collectionName;

      } catch (loadError) {
        // Si falla y no es la ruta por defecto, intentar con la ruta por defecto
        if (modelPath !== this._defaultModelPath) {
          console.warn(`⚠️ Failed to load from ${modelPath}`);
          console.warn(`   Error: ${loadError.message}`);
          console.warn(`   Trying default location...`);

          try {
            const defaultPath = path.resolve(process.cwd(), this._defaultModelPath, `${ModelName}.js`);
            const defaultUrl = pathToFileURL(defaultPath).href;

            console.log(`   Attempting: ${defaultPath}`);

            const ModelClass = (await import(defaultUrl)).default;

            if (!ModelClass) {
              throw new Error(`Modelo ${ModelName} no encontrado`);
            }

            // Crear instancia
            modelInstance = new ModelClass(db);
            modelInstance.entity = collectionName;

            console.log(`✅ Model loaded from default location: ${this._defaultModelPath}`);

          } catch (defaultError) {
            console.error(`   Default load also failed: ${defaultError.message}`);
            throw new Error(`Failed to load model ${ModelName}: ${defaultError.message}`);
          }
        } else {
          console.error(`   Failed from default location: ${loadError.message}`);
          throw new Error(`Failed to load model ${ModelName}: ${loadError.message}`);
        }
      }

    } else {
      modelInstance = new this(db);
    }

    // Configurar tenant si es necesario
    if (tenantId) {
      modelInstance.tenantId = tenantId;
    }

    return modelInstance;
  }

  // =================================================================
  // HOOKS SYSTEM
  // =================================================================

  /**
   * Add a global hook that applies to all instances of Model and its subclasses
   * @param {string} event - Hook event name
   * @param {Function} callback - Hook callback function
   */
  static addGlobalHook(event, callback) {
    if (!this._globalHooks[event]) {
      throw new Error(`Invalid hook event: ${event}. Valid events: ${Object.keys(this._globalHooks).join(', ')}`);
    }
    if (typeof callback !== 'function') {
      throw new Error('Hook callback must be a function');
    }
    this._globalHooks[event].push(callback);
  }

  /**
   * Remove a global hook
   * @param {string} event - Hook event name
   * @param {Function} callback - Hook callback function to remove
   */
  static removeGlobalHook(event, callback) {
    if (!this._globalHooks[event]) {
      throw new Error(`Invalid hook event: ${event}`);
    }
    const index = this._globalHooks[event].indexOf(callback);
    if (index > -1) {
      this._globalHooks[event].splice(index, 1);
    }
  }

  /**
   * Clear all global hooks for an event
   * @param {string} event - Hook event name
   */
  static clearGlobalHooks(event) {
    if (!this._globalHooks[event]) {
      throw new Error(`Invalid hook event: ${event}`);
    }
    this._globalHooks[event] = [];
  }

  /**
   * Add an instance hook that applies only to this model instance
   * @param {string} event - Hook event name
   * @param {Function} callback - Hook callback function
   */
  addInstanceHook(event, callback) {
    if (!this._instanceHooks[event]) {
      throw new Error(`Invalid hook event: ${event}. Valid events: ${Object.keys(this._instanceHooks).join(', ')}`);
    }
    if (typeof callback !== 'function') {
      throw new Error('Hook callback must be a function');
    }
    this._instanceHooks[event].push(callback);
    return this; // Allow chaining
  }

  /**
   * Remove an instance hook
   * @param {string} event - Hook event name
   * @param {Function} callback - Hook callback function to remove
   */
  removeInstanceHook(event, callback) {
    if (!this._instanceHooks[event]) {
      throw new Error(`Invalid hook event: ${event}`);
    }
    const index = this._instanceHooks[event].indexOf(callback);
    if (index > -1) {
      this._instanceHooks[event].splice(index, 1);
    }
    return this; // Allow chaining
  }

  /**
   * Clear all instance hooks for an event
   * @param {string} event - Hook event name
   */
  clearInstanceHooks(event) {
    if (!this._instanceHooks[event]) {
      throw new Error(`Invalid hook event: ${event}`);
    }
    this._instanceHooks[event] = [];
    return this; // Allow chaining
  }

  /**
   * Execute hooks for a given event
   * @param {string} event - Hook event name
   * @param {Object} context - Context object passed to hooks
   * @private
   */
  async _executeHooks(event, context) {
    const globalHooks = Model._globalHooks[event] || [];
    const instanceHooks = this._instanceHooks[event] || [];

    // Instance hooks have priority over global hooks
    const allHooks = [...globalHooks, ...instanceHooks];

    for (const hook of allHooks) {
      try {
        await hook.call(this, context);
      } catch (error) {
        console.error(`❌ Hook error in ${event}:`, error);
        throw new Error(`Hook execution failed in ${event}: ${error.message}`);
      }
    }
  }

  // =================================================================
  // OBSERVER SYSTEM
  // =================================================================

  /**
   * Add a global observer that watches all Model instances
   * @param {Object} observer - Observer object with event handler methods
   */
  static addGlobalObserver(observer) {
    if (!observer || typeof observer !== 'object') {
      throw new Error('Observer must be an object');
    }
    this._globalObservers.add(observer);
  }

  /**
   * Remove a global observer
   * @param {Object} observer - Observer object to remove
   */
  static removeGlobalObserver(observer) {
    this._globalObservers.delete(observer);
  }

  /**
   * Clear all global observers
   */
  static clearGlobalObservers() {
    this._globalObservers.clear();
  }

  /**
   * Add an instance observer that watches only this model instance
   * @param {Object} observer - Observer object with event handler methods
   */
  addInstanceObserver(observer) {
    if (!observer || typeof observer !== 'object') {
      throw new Error('Observer must be an object');
    }
    this._instanceObservers.add(observer);
    return this; // Allow chaining
  }

  /**
   * Remove an instance observer
   * @param {Object} observer - Observer object to remove
   */
  removeInstanceObserver(observer) {
    this._instanceObservers.delete(observer);
    return this; // Allow chaining
  }

  /**
   * Clear all instance observers
   */
  clearInstanceObservers() {
    this._instanceObservers.clear();
    return this; // Allow chaining
  }

  /**
   * Notify observers of an event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @private
   */
  async _notifyObservers(event, data) {
    const globalObservers = Array.from(Model._globalObservers);
    const instanceObservers = Array.from(this._instanceObservers);

    // Instance observers have priority over global observers
    const allObservers = [...globalObservers, ...instanceObservers];

    for (const observer of allObservers) {
      if (typeof observer[event] === 'function') {
        try {
          await observer[event].call(observer, data, this);
        } catch (error) {
          console.error(`❌ Observer error in ${event}:`, error);
          // Don't throw - observers should not break the main flow
        }
      }
    }
  }

  /**
   * Obtiene la instancia del reader (datasource adapter) configurado
   */
  async getReader() {
    return this._getDatasource();
  }

  // =================================================================
  // MÉTODOS CRUD
  // =================================================================

  async create(data) {
    const context = { operation: 'create', data, model: this };

    // Execute beforeCreate hooks
    await this._executeHooks('beforeCreate', context);

    // Validar contra schema si está habilitado
    if (this.enableSchemaValidation && this.schema) {
      const validation = this._validateAgainstSchema(context.data, false);
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
    }

    const datasource = await this._getDatasource();

    // Pass model config needed by Datasource
    // (Datasource instance has reference to model, but we pass extra context)

    let result;
    try {
      result = await datasource.create(context.data, {});
    } catch (error) {
      if (error instanceof DuplicateEntryError) throw error;
      throw error;
    }

    // Update context with final result
    context.result = result;

    // Execute afterCreate hooks
    await this._executeHooks('afterCreate', context);

    // Notify observers
    await this._notifyObservers('created', {
      entity: this.entity,
      data: result,
      operation: 'create',
      timestamp: new Date()
    });

    return result;
  }

  async upsert(data) {
    const context = { operation: 'upsert', data, model: this };

    // Validar contra schema
    if (this.enableSchemaValidation && this.schema) {
      const validation = this._validateAgainstSchema(context.data, false);
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // We delegate upsert logic completely to Strategy
    // Strategy handles finding existing and updating, or creating.

    const datasource = await this._getDatasource();
    const result = await datasource.upsert(context.data, {});

    return result;
  }

  async update(data) {
    const docId = data[this.idField];
    if (!docId) {
      throw new Error(`Update error: Missing required identifier "${this.idField}"`);
    }

    const context = { operation: 'update', data, docId, model: this };

    // Execute beforeUpdate hooks
    await this._executeHooks('beforeUpdate', context);

    // Validar contra schema si está habilitado (como update)
    if (this.enableSchemaValidation && this.schema) {
      const validation = this._validateAgainstSchema(context.data, true);
      if (!validation.valid) {
        throw new Error(`Schema validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Get old data (agnostic)
    let oldData;
    const datasource = await this._getDatasource();
    try {
      oldData = await datasource.getById(docId); // Use wrapper
    } catch (e) {
      console.warn('Could not retrieve old data for hooks:', e.message);
    }

    const result = await datasource.update(context.data, {});

    // Update context with old and new data
    context.oldData = oldData;
    context.result = result;

    // Execute afterUpdate hooks
    await this._executeHooks('afterUpdate', context);

    // Notify observers
    await this._notifyObservers('updated', {
      entity: this.entity,
      oldData,
      newData: result,
      changes: context.data,
      operation: 'update',
      timestamp: new Date()
    });

    return result;
  }

  /*
    Performance: For large collections, list() does full scans—consider adding query builders for filters/sorts.
    Typesense sync could be batched for bulk ops.
  */
  async list(undeletedOnly = true) {
    try {
      const datasource = await this._getDatasource();
      return datasource.list({ undeletedOnly });
    } catch (error) {
      throw new Error(`List error: ${error.message}`);
    }
  }

  async listPaginated({ limit = 10, startAfter = null, orderBy = 'created_at', orderDirection = 'asc', undeletedOnly = true }) {
    try {
      const datasource = await this._getDatasource();

      // Note: Model.listPaginated signature uses object param, DatasourceStrategy expects options object.
      const options = {
        limit,
        startAfter,
        orderBy,
        orderDirection,
        undeletedOnly
      };
      return datasource.listPaginated(options);
    } catch (error) {
      throw new Error(`Paginated list error: ${error.message}`);
    }
  }

  async print(undeletedOnly = true) {
    const records = await this.list(undeletedOnly);
    console.log(`Found ${records.length} ${this.entity}:`);
    for (const item of records) {
      console.log(`📄 ID: ${item[this.idField]}`);
      console.log('   Data:', item);
    }
  }

  async getById(id) {
    try {
      const datasource = await this._getDatasource();
      return datasource.getById(id, { tenantId: this.tenantId });
    } catch (error) {
      throw new Error(`Error fetching ${this.entity}: ${error.message}`);
    }
  }

  async getCountByMonth(year, month) {
    try {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);

      const datasource = await this._getDatasource();
      const options = {
        where: [
          { field: 'created_at', operator: '>=', value: start },
          { field: 'created_at', operator: '<=', value: end },
        ]
      };

      if (this._isSoftDeleteEnabled()) {
        if (!options.where) options.where = [];
        options.where.push({ field: 'deleted_at', operator: '==', value: null });
      }

      return datasource.count(options);
    } catch (error) {
      throw new Error(`Error filtering ${this.entity} by month: ${error.message}`);
    }
  }

  async listByTenantId(tenantId, includeNull = true) {
    const datasource = await this._getDatasource();
    return datasource.listByTenantId(tenantId, includeNull);
  }

  async delete(id) {
    const context = { operation: 'delete', id, model: this };
    await this._executeHooks('beforeDelete', context);

    const datasource = await this._getDatasource();

    // Get data before deletion (if possible, to return it)
    let deletedData = null;
    try {
      deletedData = await datasource.getById(id);
    } catch (e) {
      console.warn('Could not retrieve data before delete:', e.message);
    }

    // Check soft delete
    const useSoftDelete = this._isSoftDeleteEnabled();
    let result;

    if (useSoftDelete) {
      result = await this.softDelete(id);
    } else {
      // Hard delete
      result = await datasource.delete(id, {});
    }

    // Result structure normalization?
    if (!result.deletedData) result.deletedData = deletedData;
    result.useSoftDelete = useSoftDelete;

    context.result = result;
    context.deletedData = deletedData;

    await this._executeHooks('afterDelete', context);
    await this._notifyObservers('deleted', {
      entity: this.entity,
      data: deletedData,
      id,
      useSoftDelete,
      operation: 'delete',
      timestamp: new Date()
    });

    return result;
  }

  async softDelete(id) {
    const datasource = await this._getDatasource();
    return datasource.softDelete(id, {});
  }

  /**
   * MÉTODO GENÉRICO: Buscar documentos que cumplan condiciones WHERE
   * Funciona con CUALQUIER datasource configurado (Firebase, Supabase, MySQL)
   *
   * @param {Object} options - Opciones de consulta
   * @param {Array} options.where - Array de condiciones where [{field, operator, value}]
   * @param {string} options.orderBy - Campo por el cual ordenar
   * @param {string} options.orderDirection - Dirección del ordenamiento ('asc' | 'desc')
   * @param {number} options.limit - Límite de resultados
   * @param {boolean} options.undeletedOnly - Solo documentos no eliminados (default: true)
   * @returns {Promise<Array>} Array de documentos que cumplen las condiciones
   *
   * @example
   * // Buscar sesiones de caja abiertas para un cajero
   * const openSessions = await model.findWhere({
   *   where: [
   *     { field: 'cashier_id', operator: '==', value: 'user123' },
   *     { field: 'status', operator: '==', value: 'open' }
   *   ],
   *   limit: 1
   * });
   */
  async findWhere(options = {}) {
    const datasource = await this._getDatasource();
    return datasource.findWhere(options);
  }

  async getAll(options = {}) {
    const datasource = await this._getDatasource();
    return datasource.findWhere(options);
  }

  async readById(id, options = {}) {
    const datasource = await this._getDatasource();
    return datasource.getById(id, options);
  }

  async read(options = {}) {
    const datasource = await this._getDatasource();

    // Fallback if read is not implemented (e.g. partial datasource implementation)
    if (typeof datasource.read !== 'function') {
      console.warn(`⚠️ Datasource '${this.datasourceName}' does not implement read(), using findWhere/list fallback.`);

      // Attempt to use list/findWhere to satisfy the request
      // Note: This might lose advanced pagination features if datasource doesn't support them in list()
      let docs = [];
      try {
        if (typeof datasource.listPaginated === 'function') {
          return datasource.listPaginated(options);
        } else {
          docs = await datasource.findWhere(options);
          return {
            docs: docs,
            pagination: {
              found: docs.length,
              total: docs.length, // Approximate
              hasMore: false,
              page: 1,
              limit: options.limit || docs.length
            }
          };
        }
      } catch (e) {
        console.error('❌ Datasource Error (Fallback failed):', {
          datasourceName: this.datasourceName,
          entity: this.entity,
          error: e.message
        });
        throw new Error(`Datasource strategy '${this.datasourceName}' does not implement read()`);
      }
    }

    return datasource.read(options);
  }

  /**
   * Gets a single record matching conditions
   * @param {Object} options - Query options
   * @returns {Promise<Object>} The matching record or null
   */
  async get(options = {}) {
    try {
      const datasource = await this._getDatasource();
      const { where = [], orderBy, orderDirection, undeletedOnly = true } = options;

      const opts = {
        collection: this.entity,
        limit: 1,
        orderBy: orderBy || this.idField || 'id',
        order: orderDirection || 'asc',
        where: [...where],
        tenantId: this.tenantId,
        useTenantSubcollections: this.useTenantSubcollections
      };

      if (undeletedOnly) { // && this._isSoftDeleteEnabled() ?
        opts.where.push({ field: 'deleted_at', operator: '==', value: null });
      }

      const results = await datasource.findWhere(opts);
      return results[0] || null;
    } catch (e) {
      throw new Error(`Get error in ${this.entity}: ${e.message}`);
    }
  }

  async count(options = {}) {
    try {
      const datasource = await this._getDatasource();
      const { where = [], undeletedOnly = true } = options;

      const opts = { ...options }; // Copy options

      if (undeletedOnly && this._isSoftDeleteEnabled()) {
        if (!opts.where) opts.where = [];
        const hasDeletedFilter = opts.where.some(f => f.field === 'deleted_at');
        if (!hasDeletedFilter) {
          opts.where.push({ field: 'deleted_at', operator: '==', value: null });
        }
      }

      return datasource.count(opts);
    } catch (error) {
      throw new Error(`Count error in ${this.entity}: ${error.message}`);
    }
  }

  /**
   * Close the underlying database connection pool
   */
  async close() {
    if (this.datasource && typeof this.datasource.close === 'function') {
      await this.datasource.close();
    }
  }

  /**
   * Get pool statistics for monitoring
   */
  getPoolStats() {
    if (this.datasource && typeof this.datasource.getPoolStats === 'function') {
      return this.datasource.getPoolStats();
    }
    return null;
  }
}