import { FieldValue } from 'firebase-admin/firestore';
import DuplicateEntryError from '../../../errors/DuplicateEntryError.js';
import { Timestamp } from 'firebase-admin/firestore';

export default class FirestoreReader {
    constructor(db) {
        this.db = db;
    }

    /**
     * Unified read method matching PostgresReader.read
     * Aliases getCollection
     */
    async read(collection, options = {}) {
        return this.getCollection(collection, options);
    }

    async getDocumentWithSubcollections(collection, id, options = {}) {
        const collectionRef = this._getCollectionRef(collection, options);
        const ref = collectionRef.doc(id);

        const doc = await ref.get();
        if (!doc.exists) {
            throw new Error(`Document ${id} not found in ${collection}`);
        }

        const result = doc.data();
        result.id = doc.id;

        if (options.includeAll || options.include?.length > 0) {
            result.subcollections = await this._getSubcollectionsRecursive(docRef, options, 1);
        }

        return result;
    }

    async getCollection(collection, options = {}) {
        console.log(`[FirestoreReader] Starting getCollection for collection: ${collection}`);
        console.log(`[FirestoreReader] Options:`, {
            filter: options.filter,
            q: options.q,
            orderBy: options.orderBy,
            order: options.order,
            limit: options.limit,
            lastDocId: options.lastDocId
        });

        let query = this._getCollectionRef(collection, options);

        // Parámetros con valores por defecto
        const orderBy = options.orderBy || '__name__';
        const order = options.order === 'desc' ? 'desc' : 'asc';
        const limit = parseInt(options.limit) || 20;

        // Aplicar ordenamiento
        if (orderBy !== '__name__') {
            query = query.orderBy(orderBy, order).orderBy('__name__', order);
        } else {
            query = query.orderBy('__name__', order);
        }

        console.log(`[FirestoreReader] Before applying filters, filter option is:`, options.filter);

        // Aplicar filtros si se proporcionan
        if (options.filter) {
            console.log(`[FirestoreReader] About to apply filters: ${options.filter}`);
            query = this._applyFiltersToQuery(query, options.filter);
            console.log(`[FirestoreReader] Filters applied successfully`);
        } else {
            console.log(`[FirestoreReader] No filters to apply`);
        }

        // CORREGIDO: Paginación simplificada
        if (options.lastDocId) {
            try {
                const lastDocRef = this._getCollectionRef(collection, options).doc(options.lastDocId);
                const lastDocSnap = await lastDocRef.get();

                if (!lastDocSnap.exists) {
                    throw new Error(`Pagination cursor document '${options.lastDocId}' not found.`);
                }

                query = query.startAfter(lastDocSnap);
            } catch (error) {
                console.error('Error in pagination cursor:', error);
                throw new Error(`Invalid pagination cursor: ${error.message}`);
            }
        }

        // Aplicar límite (si hay búsqueda de texto, usar límite más alto para filtrado en memoria)
        const effectiveLimit = options.q && options.q !== '*' ? Math.max(limit * 5, 100) : limit;
        query = query.limit(effectiveLimit);

        console.log(`[FirestoreReader] Executing query with effective limit: ${effectiveLimit}`);
        const snap = await query.get();
        console.log(`[FirestoreReader] Query returned ${snap.size} documents`);

        let docs = [];

        for (const doc of snap.docs) {
            const data = doc.data();
            data.id = doc.id;

            if (options.includeAll || options.include?.length > 0) {
                data.subcollections = await this._getSubcollectionsRecursive(doc.ref, options, 1);
            }
            docs.push(data);
        }

        console.log(`[FirestoreReader] Before text search filtering, we have ${docs.length} documents`);

        // Aplicar búsqueda de texto en memoria si se proporciona el parámetro q
        let searchText = options.q;

        // Si hay filtros de campos de texto, combinarlos con la búsqueda de texto
        if (options.filter) {
            const textFields = ['email', 'displayName', 'name', 'description', 'title'];
            const filterParts = options.filter.split(' && ').filter(Boolean);

            for (const part of filterParts) {
                const [field, ...valueParts] = part.split(':');
                const value = valueParts.join(':').trim();

                if (field && value && textFields.includes(field.trim())) {
                    // Si hay un filtro de campo de texto, combinarlo con la búsqueda
                    if (searchText && searchText !== '*') {
                        // Si ya hay un término de búsqueda, combinarlos
                        searchText = `${searchText} ${value}`;
                    } else {
                        // Si no hay término de búsqueda, usar solo el valor del filtro
                        searchText = value;
                    }
                }
            }
        }

        if (searchText && searchText !== '*') {
            docs = this._filterByTextSearch(docs, searchText, options.searchFields);
            console.log(`[FirestoreReader] After text search filtering, we have ${docs.length} documents`);
        }

        // IMPORTANTE: Siempre limitar al límite solicitado
        // Esto evita devolver más documentos de los pedidos
        const found = docs.length; // Guardar el total encontrado ANTES de limitar
        docs = docs.slice(0, limit);
        console.log(`[FirestoreReader] After limiting to ${limit}, we have ${docs.length} documents`);

        // Calcular el total de documentos considerando los filtros aplicados
        let total = null;
        try {
            if (options.q && options.q !== '*') {
                // When there's a text search, we need to fetch all matching documents
                // and count them manually, since Firestore doesn't support text search in count queries
                let countQuery = this._getCollectionRef(collection, options);

                // Aplicar los mismos filtros que en la query principal
                if (options.filter) {
                    countQuery = this._applyFiltersToQuery(countQuery, options.filter);
                }

                // Fetch all documents that match the filters (but not limited by pagination)
                const allDocsSnapshot = await countQuery.get();
                let allDocs = [];

                for (const doc of allDocsSnapshot.docs) {
                    const data = doc.data();
                    data.id = doc.id;
                    allDocs.push(data);
                }

                // Apply text search filter (including text field filters) to get the count of matching documents
                let searchText = options.q;

                // Si hay filtros de campos de texto, combinarlos con la búsqueda de texto
                if (options.filter) {
                    const textFields = ['email', 'displayName', 'name', 'description', 'title'];
                    const filterParts = options.filter.split(' && ').filter(Boolean);

                    for (const part of filterParts) {
                        const [field, ...valueParts] = part.split(':');
                        const value = valueParts.join(':').trim();

                        if (field && value && textFields.includes(field.trim())) {
                            // Si hay un filtro de campo de texto, combinarlo con la búsqueda
                            if (searchText && searchText !== '*') {
                                // Si ya hay un término de búsqueda, combinarlos
                                searchText = `${searchText} ${value}`;
                            } else {
                                // Si no hay término de búsqueda, usar solo el valor del filtro
                                searchText = value;
                            }
                        }
                    }
                }

                const filteredDocs = this._filterByTextSearch(allDocs, searchText, options.searchFields);
                total = filteredDocs.length;

                console.log(`[FirestoreReader] Collection: ${collection}, Total count after text search: ${total}, Search query: ${options.q || 'none'}, Filter: ${options.filter || 'none'}, LastDocId: ${options.lastDocId || 'none'}`);
            } else {
                // When there's no text search, we can use the efficient count query
                let countQuery = this._getCollectionRef(collection, options);

                // Aplicar los mismos filtros que en la query principal
                if (options.filter) {
                    countQuery = this._applyFiltersToQuery(countQuery, options.filter);
                }

                const countSnapshot = await countQuery.count().get();
                total = countSnapshot.data().count;
                console.log(`[FirestoreReader] Collection: ${collection}, Total count: ${total}, Search query: ${options.q || 'none'}, Filter: ${options.filter || 'none'}, LastDocId: ${options.lastDocId || 'none'}`);
            }
        } catch (error) {
            console.error(`[FirestoreReader] Error calculating total count for ${collection}:`, error);
            // Si falla el conteo, devolver null (el frontend usará found como fallback)
            total = null;
        }

        // Información de paginación simplificada
        const lastDoc = docs[docs.length - 1];
        const pagination = {
            found: found,
            total: total, // Total real en la colección considerando los filtros
            hasMore: docs.length === limit,
            nextCursor: lastDoc ? lastDoc.id : null
        };

        console.log(`[FirestoreReader] Pagination info:`, pagination);

        return { docs, pagination };
    }

    /**
     * Filtrar documentos por búsqueda de texto en memoria
     * Búsqueda básica que busca coincidencias parciales (case-insensitive)
     */
    _filterByTextSearch(docs, searchText, searchFields = null) {
        if (!searchText || searchText === '*') {
            return docs;
        }

        const searchTerms = searchText.toLowerCase().trim().split(/\s+/);

        return docs.filter(doc => {
            // Determinar en qué campos buscar
            const fieldsToSearch = searchFields || this._getDefaultSearchFields(doc);

            // Concatenar todos los valores de los campos de búsqueda
            const searchableContent = fieldsToSearch
                .map(field => this._getNestedValue(doc, field))
                .filter(value => value !== null && value !== undefined)
                .map(value => {
                    if (Array.isArray(value)) {
                        return value.join(' ');
                    }
                    return String(value);
                })
                .join(' ')
                .toLowerCase();

            // Verificar si todos los términos de búsqueda están presentes
            return searchTerms.every(term => searchableContent.includes(term));
        });
    }

    /**
     * Obtener campos de búsqueda por defecto basados en el tipo de datos
     */
    _getDefaultSearchFields(doc) {
        const fields = [];

        for (const [key, value] of Object.entries(doc)) {
            // Incluir campos de tipo string (excepto IDs y campos técnicos)
            if (typeof value === 'string' &&
                !key.endsWith('_id') &&
                !key.endsWith('Id') &&
                key !== 'id' &&
                !key.startsWith('_')) {
                fields.push(key);
            }
            // Incluir arrays de strings
            else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
                fields.push(key);
            }
        }

        return fields;
    }

    /**
     * Aplica filtros a una query de Firestore
     * @param {Query} query - La query de Firestore a la que aplicar los filtros
     * @param {string} filterString - Cadena de filtro en formato "field:value && field2:value2"
     * @returns {Query} - La query modificada con los filtros aplicados
     */
    _applyFiltersToQuery(query, filterString) {
        if (!filterString || !filterString.trim()) {
            console.log('[FirestoreReader] No filter string provided or it is empty');
            return query;
        }

        console.log(`[FirestoreReader] Applying filters: ${filterString}`);

        // Dividir por ' && ' (con espacios)
        const filterParts = filterString.split(' && ').filter(Boolean);

        for (const part of filterParts) {
            const [field, ...valueParts] = part.split(':');
            const value = valueParts.join(':').trim(); // Reconstruir en caso de que el valor contenga ':'

            if (!field || !value) {
                console.warn(`[FirestoreReader] Invalid filter format: ${part}`);
                continue;
            }

            const fieldName = field.trim();

            console.log(`[FirestoreReader] Processing filter: ${fieldName} == ${value}`);

            // Campos de texto que requieren coincidencia parcial (no exacta)
            // Estos campos deben ser manejados por la búsqueda de texto en memoria
            const textFields = ['email', 'displayName', 'name', 'description', 'title'];

            if (textFields.includes(fieldName)) {
                // No aplicar filtro en la query de Firestore para campos de texto
                // Estos se manejan en la búsqueda de texto en memoria
                console.log(`[FirestoreReader] Skipping Firestore filter for text field: ${fieldName}, will be handled by text search`);
                continue;
            }

            // Manejar valores booleanos
            if (value === 'true' || value === 'false') {
                query = query.where(fieldName, '==', value === 'true');
            }
            // Manejar valores nulos
            else if (value === 'null') {
                query = query.where(fieldName, '==', null);
            }
            // Manejar valores no nulos
            else if (value === '!null') {
                query = query.where(fieldName, '!=', null);
            }
            // Otros valores (numéricos, cadenas exactas, etc.)
            else {
                // Try to convert to number if it looks like one, otherwise use as string
                let processedValue = value;
                if (!isNaN(value) && !isNaN(parseFloat(value))) {
                    processedValue = parseFloat(value);
                    console.log(`[FirestoreReader] Converted ${value} to number: ${processedValue}`);
                }
                query = query.where(fieldName, '==', processedValue);
            }
        }

        console.log('[FirestoreReader] Filtered query constructed');
        return query;
    }

    /**
     * Obtener valor anidado de un objeto usando notación de punto
     */
    _getNestedValue(obj, path) {
        return path.split('.').reduce((current, prop) =>
            current && current[prop] !== undefined ? current[prop] : null, obj);
    }

    async _getSubcollectionsRecursive(docRef, options, currentDepth) {
        if (options.depth && currentDepth > options.depth) return {};

        const subcols = await docRef.listCollections();
        const result = {};

        for (const subcol of subcols) {
            if (
                options.includeAll ||
                (Array.isArray(options.include) && options.include.includes(subcol.id))
            ) {
                const subDocsSnap = await subcol.get();
                result[subcol.id] = [];

                for (const subDoc of subDocsSnap.docs) {
                    const data = subDoc.data();
                    data.id = subDoc.id;
                    data.subcollections = await this._getSubcollectionsRecursive(subDoc.ref, options, currentDepth + 1);
                    result[subcol.id].push(data);
                }
            }
        }
        return result;
    }


    /**
     * Create a new document in Firestore
     * Handles uniqueness checks and transactions
     */
    async create(collection, data, options = {}) {
        const { uniqueFields = [], tenantId = null, useTenantSubcollections = false } = options;
        const collectionRef = this._getCollectionRef(collection, options);

        let docId = data.id;
        if (!docId) {
            docId = collectionRef.doc().id;
        }

        const mainDocRef = collectionRef.doc(docId);

        try {
            await this.db.runTransaction(async (transaction) => {
                // Uniqueness check
                if (uniqueFields.length > 0) {
                    await this._handleUniquenessOnCreate(transaction, collection, data, docId, options);
                }

                const { id, ...cleanData } = data; // Remove id from data to avoid redundancy if passed
                const toInsert = {
                    ...cleanData,
                    created_at: data.created_at || FieldValue.serverTimestamp(),
                    updated_at: data.updated_at || FieldValue.serverTimestamp(),
                    deleted_at: data.deleted_at || null,
                };
                transaction.set(mainDocRef, toInsert);
            });
        } catch (error) {
            console.error(`[FirestoreReader] Create transaction failed for ${docId}:`, error);
            throw error;
        }

        const snap = await mainDocRef.get();
        if (!snap.exists) {
            throw new Error('Failed to retrieve document after creation');
        }

        return { id: docId, ...snap.data() };
    }

    /**
     * Update a document in Firestore
     * Handles uniqueness checks and transactions
     */
    async update(collection, id, data, options = {}) {
        const { uniqueFields = [], tenantId = null, useTenantSubcollections = false } = options;
        const collectionRef = this._getCollectionRef(collection, options);
        const mainDocRef = collectionRef.doc(id);

        let oldData = null;
        let finalResult = null;

        await this.db.runTransaction(async (transaction) => {
            const docSnapshot = await transaction.get(mainDocRef);
            if (!docSnapshot.exists) {
                throw new Error('Document not found');
            }
            oldData = docSnapshot.data();

            // Uniqueness check for updates
            if (uniqueFields.length > 0) {
                await this._handleUniquenessOnUpdate(transaction, collection, oldData, data, id, options);
            }

            const { id: _, ...cleanData } = data;
            const updateData = {
                ...cleanData,
                updated_at: FieldValue.serverTimestamp(),
            };

            transaction.update(mainDocRef, updateData);
            finalResult = { id, ...oldData, ...updateData }; // Optimistic result
        });

        // Fetch actual result to be sure (especially regarding server timestamps)
        const updatedSnapshot = await mainDocRef.get();
        return { id, ...updatedSnapshot.data() };
    }

    /**
     * Delete a document from Firestore
     */
    async delete(collection, id, options = {}) {
        const { uniqueFields = [], tenantId = null, useTenantSubcollections = false } = options;
        const collectionRef = this._getCollectionRef(collection, options);
        const mainDocRef = collectionRef.doc(id);

        await this.db.runTransaction(async (transaction) => {
            const docSnapshot = await transaction.get(mainDocRef);
            if (!docSnapshot.exists) {
                // Idempotent delete (optional warning)
                return;
            }
            const data = docSnapshot.data();

            // Handle uniqueness cleanup
            if (uniqueFields.length > 0) {
                await this._handleUniquenessOnDelete(transaction, collection, data, options);
            }

            transaction.delete(mainDocRef);
        });
    }

    /**
     * Get single document by ID (alias to getDocumentWithSubcollections but simpler default)
     */
    async getById(collection, id, options = {}) {
        return this.getDocumentWithSubcollections(collection, id, options);
    }

    /**
     * General find method supporting complex where clauses
     * Compatible with Model.findWhere expectations
     */
    async find(collection, options = {}) {
        const { where = [], limit, orderBy, orderDirection, startAfter } = options;
        const collectionRef = this._getCollectionRef(collection, options);
        let query = collectionRef;

        // Apply where conditions
        if (where && Array.isArray(where)) {
            for (const cond of where) {
                // Ignore invalid conditions
                if (!cond.field || !cond.operator || cond.value === undefined) continue;
                query = query.where(cond.field, cond.operator, cond.value);
            }
        }

        // Apply string filters if present (legacy support)
        if (options.filter) {
            query = this._applyFiltersToQuery(query, options.filter);
        }

        // Apply orderBy
        if (orderBy) {
            query = query.orderBy(orderBy, orderDirection || 'asc');
        }

        if (startAfter) {
            query = query.startAfter(startAfter);
        }

        if (limit) {
            query = query.limit(limit);
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    /**
     * Get count of documents
     */
    async count(collection, options = {}) {
        const collectionRef = this._getCollectionRef(collection, options);
        let query = collectionRef;

        // Apply where conditions (new structured support)
        if (options.where && Array.isArray(options.where)) {
            for (const cond of options.where) {
                if (!cond.field || !cond.operator || cond.value === undefined) continue;
                query = query.where(cond.field, cond.operator, cond.value);
            }
        }

        if (options.filter) {
            query = this._applyFiltersToQuery(query, options.filter);
        }

        const snapshot = await query.count().get();
        return snapshot.data().count;
    }

    // ===========================================
    // Helper Methods
    // ===========================================

    _getCollectionRef(collection, options) {
        if (options.useTenantSubcollections && options.tenantId) {
            return this.db.collection(collection).doc(options.tenantId).collection('data');
        } else if (options.useTenantSubcollections && !options.tenantId) {
            throw new Error(`Collection '${collection}' is tenant-aware, but no tenant ID was set.`);
        }
        return this.db.collection(collection);
    }

    _getUniqueDocRef(collection, field, value, options) {
        const uniqueCollectionName = `__unique_${collection}`;
        const sanitizedValue = String(value).replace(/\//g, '_');
        const docId = `[${field}]:${sanitizedValue}`;

        if (options.useTenantSubcollections && options.tenantId) {
            return this.db.collection(uniqueCollectionName).doc(options.tenantId).collection('data').doc(docId);
        } else {
            return this.db.collection(uniqueCollectionName).doc(docId);
        }
    }

    async _handleUniquenessOnCreate(transaction, collection, data, docId, options) {
        const { uniqueFields } = options;
        const uniqueChecks = [];

        for (const field of uniqueFields) {
            const value = data[field];
            if (value !== undefined && value !== null && value !== '') {
                uniqueChecks.push({
                    ref: this._getUniqueDocRef(collection, field, value, options),
                    field,
                    value,
                });
            }
        }

        if (uniqueChecks.length === 0) return;

        const uniqueDocs = await transaction.getAll(...uniqueChecks.map(c => c.ref));

        for (let i = 0; i < uniqueDocs.length; i++) {
            if (uniqueDocs[i].exists) {
                throw new DuplicateEntryError(uniqueChecks[i].field, uniqueChecks[i].value);
            }
        }

        for (const check of uniqueChecks) {
            transaction.set(check.ref, { docId });
        }
    }

    async _handleUniquenessOnUpdate(transaction, collection, oldData, newData, docId, options) {
        const { uniqueFields } = options;
        const writesToPerform = [];
        const readsToPerform = [];

        for (const field of uniqueFields) {
            const oldValue = oldData[field];
            const newValue = newData[field];

            if (newData.hasOwnProperty(field) && oldValue !== newValue) {
                if (oldValue !== undefined && oldValue !== null && oldValue !== '') {
                    writesToPerform.push({
                        type: 'delete',
                        ref: this._getUniqueDocRef(collection, field, oldValue, options),
                    });
                }

                if (newValue !== undefined && newValue !== null && newValue !== '') {
                    const newUniqueRef = this._getUniqueDocRef(collection, field, newValue, options);
                    readsToPerform.push({ ref: newUniqueRef, field, value: newValue });
                    writesToPerform.push({ type: 'set', ref: newUniqueRef, data: { docId } });
                }
            }
        }

        if (readsToPerform.length > 0) {
            const newUniqueDocs = await transaction.getAll(...readsToPerform.map(r => r.ref));
            for (let i = 0; i < newUniqueDocs.length; i++) {
                if (newUniqueDocs[i].exists) {
                    throw new DuplicateEntryError(readsToPerform[i].field, readsToPerform[i].value);
                }
            }
        }

        for (const write of writesToPerform) {
            if (write.type === 'set') {
                transaction.set(write.ref, write.data);
            } else if (write.type === 'delete') {
                transaction.delete(write.ref);
            }
        }
    }

    async _handleUniquenessOnDelete(transaction, collection, data, options) {
        const { uniqueFields } = options;
        for (const field of uniqueFields) {
            const value = data[field];
            if (value !== undefined && value !== null && value !== '') {
                const uniqueDocRef = this._getUniqueDocRef(collection, field, value, options);
                transaction.delete(uniqueDocRef);
            }
        }
    }
}