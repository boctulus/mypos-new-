import fs from 'fs/promises';
import path from 'path';
import admin from 'firebase-admin';
import { pathToFileURL } from 'url';
import Model from '../models/Model.js';

import TypesenseClient from './TypesenseClient.js';
import Typesense from './Typesense.js';

const SCHEMA_DIR = './database/typesense/schemas/';

/*
    Typesense class to manage Firestore to Typesense schema generation and synchronization.
    This class provides methods to infer field types, generate schemas, and sync data from Firestore to typesense.
*/

export default class TypesenseSchemaGenerator {
  constructor(db = null, showWarnings = false) {
    this.db = db;
    this.schemaDir = SCHEMA_DIR;
    this.showWarnings = showWarnings;
    this.typesense = new Typesense(db);
  }

  shouldBeRequired(fieldName, fieldType) {
    if (fieldName.endsWith('_id') || fieldName === 'id') return true;
    if (['created_at', 'updated_at', 'timestamp'].includes(fieldName)) return true;
    if (['name', 'title', 'status', 'email'].includes(fieldName)) return true;
    return false;
  }

  /**
   * **NEW**: Determines if a field should have infix search enabled.
   * Infix search is enabled for specific string fields to allow searching for parts of a word.
   * @param {string} fieldName - The name of the field.
   * @param {string} fieldType - The type of the field.
   * @returns {boolean} True if infix search should be enabled.
   */
  shouldHaveInfix(fieldName, fieldType) {
    if (fieldType !== 'string') {
      return false;
    }
    const infixFields = ['name', 'email', 'address'];
    return infixFields.includes(fieldName.toLowerCase()) || fieldName.endsWith('_name');
  }

  /**
   * **NEW**: Determines if a string field should be faceteable for SELECT dropdowns.
   * String fields that could be used for filtering (excluding free-text fields) should be faceteable.
   * @param {string} fieldName - The name of the field.
   * @param {string} fieldType - The type of the field.
   * @returns {boolean} True if field should be faceteable.
   */
  shouldBeFaceteable(fieldName, fieldType) {
    if (fieldType !== 'string') {
      return false;
    }

    // Excluir campos de texto libre, URLs, emails, etc.
    const excludedFields = [
      'name', 'title', 'description', 'email', 'url', 'phone', 'address', 
      'notes', 'comment', 'password', 'token', 'key', 'content', 'body', 'message'
    ];
    
    const isExcluded = excludedFields.some(excluded => fieldName.includes(excluded));
    const isIdField = fieldName === 'id' || fieldName.endsWith('_id');
    
    // Hacer faceteable campos string que no son texto libre ni IDs
    return !isExcluded && !isIdField;
  }

  async getFirstTenantId(collectionName) {
    try {
      const snapshot = await this.db.collection(collectionName).limit(1).get();
      if (snapshot.empty) {
        throw new Error(`No tenants found in collection '${collectionName}'`);
      }
      const firstDoc = snapshot.docs[0];
      return firstDoc.id;
    } catch (error) {
      console.error(`❌ Error fetching first tenantId for '${collectionName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Genera la función de sincronización que mapea un documento de Firestore
   * a un documento de Typesense, manejando correctamente los valores por defecto.
   * @param {string} collectionName - El nombre de la colección.
   * @param {Array<Object>} fields - El array de campos del esquema de typesense.
   * @returns {string} - El código de la función de sincronización como una cadena de texto.
   */
  generateSyncFunction(collectionName, fields) {
    // Define la fecha más antigua admitida como el Unix Epoch (0 ms).
    // Esto se usará para campos de fecha requeridos que sean nulos.
    const MIN_SUPPORTED_TIMESTAMP_MS = 0;

    const documentMapping = fields
      .filter(field => field.name !== 'id')
      .map(field => {
        const fieldName = field.name;
        const defaultValue = this.typesense.getDefaultValue(field);

        // Lógica específica para campos de fecha (terminados en "_at").
        // Se asume que su tipo ya fue inferido correctamente como 'int64'.
        if (field.type === 'int64' && fieldName.endsWith('_at')) {
          // Usa optional chaining (?.) y nullish coalescing (??).
          // 1. Si `data[fieldName]` existe y es un Timestamp, `toMillis()` lo convierte a número.
          // 2. Si `data[fieldName]` es `null` o `undefined`, el resultado es `undefined`.
          // 3. `?? MIN_SUPPORTED_TIMESTAMP_MS` asigna 0 si el resultado anterior fue `null` o `undefined`.
          return `  ${fieldName}: data.${fieldName}?.toMillis() ?? ${MIN_SUPPORTED_TIMESTAMP_MS},`;
        }

        // Lógica específica para campos de fecha que son strings y contienen 'date' en el nombre
        if (field.type === 'string' && fieldName.includes('date')) {
          // Convertir Timestamps de Firebase a formato de fecha string (YYYY-MM-DD)
          return `  ${fieldName}: data.${fieldName}?.toDate ? data.${fieldName}.toDate().toISOString().split('T')[0] : (Array.isArray(data.${fieldName}) ? JSON.stringify(data.${fieldName}) : (data.${fieldName}?.toString() ?? ${defaultValue})),`;
        }

        // Para arrays de objetos, serializar como JSON
        if (field.type === 'string' && fieldName !== 'id') {
          // Verificar si el campo original podría ser un array de objetos
          return `  ${fieldName}: Array.isArray(data.${fieldName}) ? JSON.stringify(data.${fieldName}) : (data.${fieldName} ?? ${defaultValue}),`;
        }

        // Para todos los demás campos, usa el operador ?? para asignar el valor por defecto
        // solo si el campo original es `null` o `undefined`. Esto es más seguro que `||`.
        return `  ${fieldName}: data.${fieldName} ?? ${defaultValue},`;
      })
      .join('\n');

    const idField = fields.find(f => f.name === 'id') || fields.find(f => f.name.endsWith('_id') || f.name.endsWith('Id')) || { name: 'id' };
    const idFieldName = idField.name;

    // Genera el template de la función de sincronización completa con paginación.
    return `
  import admin from 'firebase-admin';

  export const syncFirestoreToTypesense = async (db, TypesenseClient, tenantId = null, typesenseCollectionName = '${collectionName}') => {
    const COLLECTION_NAME = '${collectionName}';
    const BATCH_SIZE = 50; // Procesar documentos en lotes para evitar cuotas
    let totalProcessed = 0;
    let lastDoc = null;
    let allSuccess = true;
    const allFailures = [];

    // Determinar la referencia de colección basada en si se usa subcolecciones por tenant
    const getCollectionRef = () => {
      if (tenantId) {
        // Si hay un tenantId, asumimos que es una colección tenant-aware con subcolecciones
        return db.collection(COLLECTION_NAME).doc(tenantId).collection('data');
      } else {
        // Caso normal, colección directa
        return db.collection(COLLECTION_NAME);
      }
    };

    console.log(\`🔄 Iniciando sincronización paginada para \${COLLECTION_NAME}\${tenantId ? ' (tenant: ' + tenantId + ')' : ''}...\`);

    try {
      // Bucle de paginación
      while (true) {
        let query = getCollectionRef().where('deleted_at', '==', null);

        // Aplicar paginación si no es la primera llamada
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }

        query = query.limit(BATCH_SIZE);

        const snapshot = await query.get();

        if (snapshot.empty) {
          break; // No hay más documentos
        }

        const documents = snapshot.docs.map(doc => {
          const data = doc.data();
          // Agregar tenant_id al documento si es tenant-aware
          const documentWithTenant = tenantId ? { ...data, tenant_id: tenantId } : data;
          return {
            id: String(documentWithTenant.${idFieldName} || doc.id),
  ${documentMapping}
          };
        });

        if (documents.length > 0) {
          console.log(\`📦 Procesando lote de \${documents.length} documentos...\`);

          try {
            const importResults = await TypesenseClient
              .collections(typesenseCollectionName)
              .documents()
              .import(documents, { action: 'upsert' });

            const successes = importResults.filter(result => result.success).length;
            const failures = importResults.filter(result => !result.success);

            totalProcessed += successes;

            if (failures.length > 0) {
              allSuccess = false;
              allFailures.push(...failures);
              console.error(\`❌ \${failures.length} documentos fallaron en este lote:\`);
              failures.forEach((failure, index) => {
                console.error(\`  \${index + 1}. Document ID: \${failure.document?.id || 'unknown'}\`);
                console.error(\`     Error: \${failure.error || JSON.stringify(failure)}\`);
              });
            } else {
              console.log(\`✅ \${successes} documentos del lote importados exitosamente.\`);
            }
          } catch (error) {
            // Catch detailed import errors
            if (error.importResults) {
              const successes = error.importResults.filter(result => result.success).length;
              const failures = error.importResults.filter(result => !result.success);

              totalProcessed += successes;
              allSuccess = false;
              allFailures.push(...failures);

              console.error(\`❌ Importación del lote falló: \${successes} exitosos, \${failures.length} fallidos\`);
              failures.forEach((failure, index) => {
                console.error(\`  \${index + 1}. Document:\`, failure.document);
                console.error(\`     Error: \${failure.error}\`);
              });
            } else {
              console.error(\`❌ Error de importación general del lote: \${error.message}\`);
              throw error;
            }
          }
        }

        // Actualizar el documento para la próxima iteración de paginación
        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        // Verificar si hemos procesado menos documentos de los que solicitamos
        // lo que indicaría que no hay más documentos
        if (snapshot.docs.length < BATCH_SIZE) {
          break;
        }
      }

      console.log(\`✅ Sincronización completada para \${COLLECTION_NAME}\${tenantId ? ' (tenant: ' + tenantId + ')' : ''}: \${totalProcessed} documentos procesados\`);

      return {
        success: allSuccess,
        count: totalProcessed,
        failures: allFailures
      };
    } catch (error) {
      console.error(\`❌ Error sincronizando \${COLLECTION_NAME}\${tenantId ? ' (tenant: ' + tenantId + ')' : ''} a Typesense:\`, error.message);
      throw error;
    }
  };`;
  }

  // Generar el esquema para una colección
  // En libs/TypesenseSchemaGenerator.js
async generateSchemaForCollection(collectionName, force = false) {
  const collectionExists = await this.typesense.checkCollectionExists(collectionName);
  if (!collectionExists) {
    throw new Error(`Collection '${collectionName}' does not exist in Firestore`);
  }

  const schemaFileExists = await this.typesense.checkSchemaFileExists(collectionName);
  if (schemaFileExists && !force) {
    console.log(`⚠️ Schema file for '${collectionName}' already exists. Use --force to overwrite.`);
    return false;
  }

  const snapshot = await this.db.collection(collectionName).limit(5).get();
  const fieldMap = {};

  if (!snapshot.empty) {
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      for (const [key, value] of Object.entries(data)) {
        let finalType;
        let finalValue = value;
        
        // Convertir arrays de objetos a strings JSON
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          console.log(`ℹ️ Convirtiendo el campo '${key}' (array de objetos) a string JSON`);
          finalType = 'string';
          finalValue = JSON.stringify(value);
        } else {
          finalType = this.typesense.inferFieldType(key, value);
        }
        
        if (finalType && !(key in fieldMap)) {
          fieldMap[key] = {
            name: this.typesense.toValidFieldName(key),
            type: finalType,
            optional: !this.shouldBeRequired(key, finalType)
          };
        }
      }
    });
  }

  if (!Object.keys(fieldMap).some(key => key.endsWith('_id') || key === 'id')) {
    fieldMap.id = { name: 'id', type: 'string', optional: false };
  }

  let defaultSortField = ['created_at', 'updated_at', 'timestamp']
    .find(f => fieldMap[f]) || Object.keys(fieldMap).find(key => key.endsWith('_id') || key === 'id') || Object.keys(fieldMap)[0];
  fieldMap[defaultSortField].optional = false;

  const fields = Object.entries(fieldMap).map(([key, value]) => {
    const fieldType = value.type;
    const fieldDefinition = {
      name: this.typesense.toValidFieldName(key),
      type: fieldType,
      optional: !this.shouldBeRequired(key),
    };

    if (fieldType === 'bool') fieldDefinition.facet = true;
    if (this.shouldHaveInfix(key, fieldType)) fieldDefinition.infix = true;
    if (this.shouldBeFaceteable(key, fieldType)) fieldDefinition.facet = true;

    return fieldDefinition;
  });

  const schema = {
    name: collectionName,
    fields,
    default_sorting_field: defaultSortField
  };

  const syncFunction = this.generateSyncFunction(collectionName, fields);
  const content = `export default ${JSON.stringify(schema, null, 2)};\n\n${syncFunction}`;

  const schemaSubDir = path.join(this.schemaDir, collectionName);
  const filepath = path.join(schemaSubDir, `${collectionName}.schema.js`);

  await fs.mkdir(schemaSubDir, { recursive: true });
  await fs.writeFile(filepath, content);

  console.log(`✅ Schema for '${collectionName}' written to ${filepath}`);
  return true;
}

  // Generar esquema para una colección específica
  async generateSchema(collectionName, force = false) {
    try {
      const success = await this.generateSchemaForCollection(collectionName, force);
      return success;
    } catch (error) {
      console.error(`❌ Error generating schema for '${collectionName}':`, error.message);
      return false;
    }
  }

  // Generar esquemas para todas las colecciones
  async generateAllSchemas(force = false) {
    try {
      const list = await this.db.listCollections();
      const collections = list.map(col => col.id);
      if (collections.length === 0) {
        console.log('ℹ️ No collections found in Firestore.');
        return [];
      }
      console.log(`📋 Found ${collections.length} collections: ${collections.join(', ')}`);
      const skipped = [];
      for (const colName of collections) {
        const success = await this.generateSchemaForCollection(colName, force);
        if (!success) skipped.push(colName);
      }
      return skipped;
    } catch (error) {
      console.error('❌ Error listing collections:', error.message);
      return [];
    }
  }

  // Método público para generar esquemas con reporte final
  async makeTypesenseSchema(collectionName, force = false) {
    let skipped = [];
    if (collectionName) {
      const success = await this.generateSchema(collectionName, force);
      if (!success) skipped.push(collectionName);
    } else {
      skipped = await this.generateAllSchemas(force);
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️ The following schemas were not overwritten (use --force to overwrite):`);
      skipped.forEach(col => console.log(`  - ${col}`));
    } else {
      console.log(`\n🎉 Schema generation completed successfully for ${collectionName ? `'${collectionName}'` : 'all collections'}.`);
    }
  }

  async syncTypesenseCollection(collectionNames, tenantId = null) {
    console.log('syncTypesenseCollection llamado con:', collectionNames, 'tenantId:', tenantId);

    if (!Array.isArray(collectionNames)) {
      collectionNames = [collectionNames];
    }

    const results = [];

    for (const collectionName of collectionNames) {
      const collectionResult = {
        collection: collectionName,
        success: false,
        error: null,
        count: 0,
        failures: []
      };

      try {
        const model = await Model.loadModel(collectionName);
        const useTenantSubcollections = model.useTenantSubcollections;

        let finalTenantId = tenantId;

        if (useTenantSubcollections && !tenantId) {
          console.log(`ℹ️ No se proporcionó tenantId para la colección tenant-aware '${collectionName}'. Obteniendo el primer tenantId...`);
          finalTenantId = await this.getFirstTenantId(collectionName);
          console.log(`ℹ️ Usando el primer tenantId encontrado: '${finalTenantId}'`);
        }

        // Obtener el nombre real de la colección en Typesense
        const typesenseCollectionName = model.getTypesenseCollectionName();
        console.log(`🏷️ Sincronizando: ${collectionName} → ${typesenseCollectionName}`);

        const schemaModule = await this.typesense.loadSchemaModule(collectionName);
        if (!schemaModule || !schemaModule.default || !schemaModule.syncFirestoreToTypesense) {
          console.error(`❌ No se encontró el esquema o la función de sincronización para '${collectionName}'`);
          collectionResult.error = 'Schema or sync function not found';
          results.push(collectionResult);
          continue;
        }

        // Actualizar el esquema con el nombre correcto
        const updatedSchema = { ...schemaModule.default, name: typesenseCollectionName };

        try {
          await TypesenseClient.collections(typesenseCollectionName).retrieve();
          console.log(`ℹ️ La colección '${typesenseCollectionName}' ya existe en Typesense`);
        } catch (error) {
          if (error.httpStatus === 404) {
            console.log(`ℹ️ La colección '${typesenseCollectionName}' no existe, creándola...`);
            await TypesenseClient.collections().create(updatedSchema);
            console.log(`✅ Colección '${typesenseCollectionName}' creada en Typesense`);
          } else {
            throw error;
          }
        }

        const result = useTenantSubcollections
          ? await schemaModule.syncFirestoreToTypesense(this.db, TypesenseClient, finalTenantId, typesenseCollectionName)
          : await schemaModule.syncFirestoreToTypesense(this.db, TypesenseClient, typesenseCollectionName);

        collectionResult.success = result.success;
        collectionResult.count = result.count;
        collectionResult.failures = result.failures || [];

        if (result.success) {
          console.log(`✅ Colección '${collectionName}' sincronizada: ${result.count} documentos procesados`);
        } else {
          console.error(`❌ Error sincronizando '${collectionName}': ${result.failures} documentos fallaron`);
          // Mostrar detalles de los errores
          if (result.failures && result.failures.length > 0) {
            console.error(`❌ Detalles de errores para '${collectionName}':`);
            result.failures.forEach((failure, index) => {
              console.error(`  ${index + 1}. Documento: ${failure.document?.id || 'desconocido'}`);
              console.error(`     Error: ${failure.error || failure}`);
            });
          }
        }

      } catch (error) {
        console.error(`❌ Error sincronizando '${collectionName}': ${error.message}`);
        collectionResult.error = error.message;
      }

      results.push(collectionResult);
    }

    return results;
  }

  // Por favor, NO MODIFICAR porque err.httpStatus  porque llega como undefined y no se puede usar asi.
  async refreshTypesenseCollection(collectionName) {
    console.log('🔄 refreshTypesenseCollection llamado con:', collectionName);

    try {
      // 1. Obtener el nombre real de la colección en Typesense usando el sistema de prefijos
      const Model = (await import('../models/Model.js')).default;
      const typesenseCollectionName = await Model.getTypesenseCollectionName(collectionName);
      
      console.log(`🏷️ Mapeando colección: ${collectionName} → ${typesenseCollectionName}`);

      // 2. Cargar el esquema usando el nombre base
      const schemaModule = await this.typesense.loadSchemaModule(collectionName);

      if (!schemaModule || !schemaModule.default) {
        console.error(`❌ No se encontró el esquema para '${collectionName}'`);
        return;
      }

      const schema = schemaModule.default;
      
      // 3. Actualizar el nombre de la colección en el esquema
      const updatedSchema = { ...schema, name: typesenseCollectionName };

      // 4. Intentar eliminar la colección existente (usar nombre con prefijo)
      try {
        await TypesenseClient.collections(typesenseCollectionName).retrieve();
        await TypesenseClient.collections(typesenseCollectionName).delete();
        console.log(`🗑️ Colección existente '${typesenseCollectionName}' eliminada`);
      } catch (err) {
        const isNotFound = err.message && err.message.includes('404');
        if (isNotFound) {
          console.log(`ℹ️ La colección '${typesenseCollectionName}' no existía`);
        } else {
          console.error(`❌ Error al verificar/eliminar la colección:`, err);
          throw err;
        }
      }

      // 5. Crear una nueva colección con el esquema actualizado
      console.log('\n📋 Creando colección con el esquema:');
      console.log(JSON.stringify(updatedSchema, null, 2));

      await TypesenseClient.collections().create(updatedSchema);
      console.log(`✅ Colección '${typesenseCollectionName}' creada en Typesense`);
    } catch (error) {
      console.error(`❌ Error refrescando la colección '${collectionName}':`, error.message || error);
    }
  }


}