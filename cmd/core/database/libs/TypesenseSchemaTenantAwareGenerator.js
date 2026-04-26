import fs from 'fs/promises';
import path from 'path';
import admin from 'firebase-admin';
import { pathToFileURL } from 'url';

import TypesenseSchemaGenerator from './TypesenseSchemaGenerator.js';
import Model from '../models/Model.js';

const SCHEMA_DIR = './database/typesense/schemas/';

  /*
    Generar el esquemas de Typesense y funciones de sincronizacion para una colección
    
    Para colecciones tenant-aware [!]  --sin ajustar--
  */
export default class TypesenseSchemaTenantAwareGenerator extends TypesenseSchemaGenerator 
{
  async generateSchemaFromCollection(collectionName, tenantId) {
    let model;

    if (tenantId === null){
      console.warn('⚠️ tenant_id is required');
      process.exit(1);
    }

    try {
      model = await Model.loadModel(collectionName);

      if (model.useTenantSubcollections && tenantId) {
        console.log(`ℹ️ Generating schema for tenant-aware collection '${collectionName}' with tenantId '${tenantId}'`);
        model.setTenant(tenantId);
      }
    } catch (e) {
      console.warn(`⚠️ Could not load model for ${collectionName}, using base model`);
      model = new Model(this.db);
      model.entity = collectionName;
    }

    const collectionRef = await model.getQueryBuilder();
    const snapshot = await collectionRef.limit(1).get();

    if (snapshot.empty) {
      throw new Error(`Collection ${collectionName} is empty`);
    }

    const sampleDoc = snapshot.docs[0].data();
    const fields = [];

    // Add ID field first
    fields.push({
      name: "id",
      type: "string",
      optional: false
    });

    // Process other fields
    for (const [key, value] of Object.entries(sampleDoc)) {
      if (key === "id") continue;

      fields.push({
        name: `${tenantId}.${key}`, // Prefix with tenantId to avoid name collisions
        type: this.inferFieldType(key, value),
        optional: true
      });
    }

    // Add tenant_id field for tenant-aware collections
    if (model.useTenantSubcollections && tenantId) {
      fields.push({
        name: "tenant_id",
        type: "string",
        optional: false
      });
    }

    return {
      name: model.useTenantSubcollections && tenantId
        ? `${collectionName}`  // do not include postfix for tenant-aware collections (we must asume all tenants have the same schema)
        : collectionName,
      fields,
      default_sorting_field: "created_at"
    };
  }

  // Método público para generar esquemas con reporte final -- punto de entrada ---
  async makeTypesenseSchema(collection, force = false, tenantId = null) {
  try {
    // Cargar el modelo dinámicamente para determinar si es tenant-aware
    const model = await Model.loadModel(collection);
    const useTenantSubcollections = model.useTenantSubcollections;

    // Para colecciones tenant-aware, tenantId es requerido
    if (useTenantSubcollections && !tenantId) {
      console.warn('⚠️ tenant_id es requerido para colecciones tenant-aware');
      process.exit(1);
    }

    // Determinar la referencia de la colección
    let collectionRef;
    if (useTenantSubcollections && tenantId) {
      collectionRef = this.db.collection(collection).doc(tenantId).collection('data');
    } else {
      collectionRef = this.db.collection(collection);
    }

    const basePath = path.resolve(process.cwd(), 'database/typesense/schemas');
    const outputDir = path.join(basePath, collection);
    const schemaPath = path.join(outputDir, `${collection}.schema.js`);

    const exists = await fs.access(schemaPath).then(() => true).catch(() => false);
    if (exists && !force) {
      console.log(`⚠️ El esquema ya existe en ${schemaPath}. Usa --force para sobrescribirlo.`);
      return;
    }

    // Obtener una muestra de documentos para inferir los campos y tipos
    const snapshot = await collectionRef.limit(10).get();
    if (snapshot.empty) {
      console.warn(`⚠️ No se encontraron documentos en ${useTenantSubcollections ? `${collection}/${tenantId}/data` : collection}. El esquema contendrá solo 'id'.`);
    }

    // Inferir los tipos de los campos
    const fieldTypes = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      for (const [key, value] of Object.entries(data)) {
        if (!(key in fieldTypes)) {
          const type = this.typesense.inferFieldType(key, value);
          fieldTypes[key] = type;
        }
      }
    });

    // Generar el esquema de Typesense
    const schema = {
      name: collection,
      fields: [
        { name: 'id', type: 'string', optional: false },
        ...(useTenantSubcollections ? [{ name: 'tenant_id', type: 'string', optional: false }] : []),
        ...Object.keys(fieldTypes).map(field => ({
          name: field,
          type: fieldTypes[field],
          optional: !this.shouldBeRequired(field, fieldTypes[field])
        }))
      ],
      default_sorting_field: Object.keys(fieldTypes).includes('created_at') ? 'created_at' : 'id'
    };

    // Generar la función de sincronización
    let syncFunction;
    if (useTenantSubcollections) {
      syncFunction = `
        export const syncFirestoreToTypesense = async (db, TypesenseClient, tenantId) => {
          const COLLECTION_NAME = '${collection}';
          try {
            const snapshot = await db.collection(COLLECTION_NAME).doc(tenantId).collection('data').where('deleted_at', '==', null).get();
            if (snapshot.empty) {
              console.log(\`No documents found in \${COLLECTION_NAME}/\${tenantId}/data to sync.\`);
              return { success: true, count: 0 };
            }
            const documents = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: \`\${tenantId}_\${doc.id}\`,
                tenant_id: tenantId,
                ...data
              };
            });
            console.log(\`Syncing \${documents.length} documents from \${COLLECTION_NAME}/\${tenantId}/data to Typesense...\`);
            const importResults = await TypesenseClient
              .collections(COLLECTION_NAME)
              .documents()
              .import(documents, { action: 'upsert' });
            const successes = importResults.filter(result => result.success).length;
            const failures = importResults.filter(result => !result.success);
            console.log(\`📦 Import result for \${COLLECTION_NAME}: \${successes} documents imported successfully.\`);
            if (failures.length > 0) {
              console.error(\`  - \${failures.length} documents failed to import:\`, failures);
            }
            return { success: failures.length === 0, count: successes, failures: failures.length };
          } catch (error) {
            console.error(\`❌ Error syncing \${COLLECTION_NAME}/\${tenantId}/data to Typesense: \`, error.message);
            throw error;
          }
        };
      `;
    } else {
      syncFunction = `
        export const syncFirestoreToTypesense = async (db, TypesenseClient) => {
          const COLLECTION_NAME = '${collection}';
          try {
            const snapshot = await db.collection(COLLECTION_NAME).where('deleted_at', '==', null).get();
            if (snapshot.empty) {
              console.log(\`No documents found in \${COLLECTION_NAME} to sync.\`);
              return { success: true, count: 0 };
            }
            const documents = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                ...data
              };
            });
            console.log(\`Syncing \${documents.length} documents from \${COLLECTION_NAME} to Typesense...\`);
            const importResults = await TypesenseClient
              .collections(COLLECTION_NAME)
              .documents()
              .import(documents, { action: 'upsert' });
            const successes = importResults.filter(result => result.success).length;
            const failures = importResults.filter(result => !result.success);
            console.log(\`📦 Import result for \${COLLECTION_NAME}: \${successes} documents imported successfully.\`);
            if (failures.length > 0) {
              console.error(\`  - \${failures.length} documents failed to import:\`, failures);
            }
            return { success: failures.length === 0, count: successes, failures: failures.length };
          } catch (error) {
            console.error(\`❌ Error syncing \${COLLECTION_NAME} to Typesense: \`, error.message);
            throw error;
          }
        };
      `;
    }

    // Crear el directorio si no existe
    await fs.mkdir(outputDir, { recursive: true });

    // Escribir el archivo de esquema
    const schemaContent = `
      export default ${JSON.stringify(schema, null, 2)};

      ${syncFunction}
    `;

    await fs.writeFile(schemaPath, schemaContent, 'utf-8');
    console.log(`✅ Schema for '${collection}' generated at ${schemaPath}`);

  } catch (error) {
    console.error(`❌ Error generando el esquema de Typesense para '${collection}': ${error.message}`);
    throw error;
  }
}


}