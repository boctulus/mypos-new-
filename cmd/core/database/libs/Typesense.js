import fs from 'fs/promises';
import path from 'path';
import admin from 'firebase-admin';
import { pathToFileURL } from 'url';

import TypesenseClient from './TypesenseClient.js';

const SCHEMA_DIR = './database/typesense/schemas/';

// Registro de mapeo para colecciones que no siguen la convención de nombres
const schemaRegistry = {
  user: 'users',
  // Agregar más mapeos aquí si es necesario
};

export default class Typesense {
  constructor(db = null, showWarnings = false) {
    this.db = db;
    this.schemaDir = SCHEMA_DIR;
    this.showWarnings = showWarnings;
  }

  // Inferir el tipo de campo (versión corregida)
  inferFieldType(key, value) {
    if (key.endsWith('_at')) {
      // Si el valor es null, asumimos que es un timestamp (int64)
      if (value === null) return 'int64';
      // Si tiene toMillis, es un timestamp de Firestore
      if (typeof value.toMillis === 'function') return 'int64';
      // Por defecto, lo tratamos como string si no es un timestamp claro
      return 'string';
    }
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return Number.isInteger(value) ? 'int32' : 'float';
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'string') return 'string';
    return 'string'; // Tipo por defecto
  }

  // Convertir a un nombre de campo válido
  toValidFieldName(name) {
    return name.replace(/[^\w]/g, '_');
  }

  // Generar valores por defecto según el tipo de campo
  getDefaultValue(field) {
    switch (field.type) {
      case 'string': return "''";
      case 'bool': return 'false';
      case 'int32':
      case 'int64':
      case 'float': return '0';
      default: return "''";
    }
  }

  // Verificar si la colección existe
  async checkCollectionExists(collectionName) {
    try {
      await this.db.collection(collectionName).limit(1).get();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Verificar si el archivo de esquema ya existe
  async checkSchemaFileExists(collectionName) {
    const schemaSubDir = path.join(this.schemaDir, collectionName);
    const filepath = path.join(schemaSubDir, `${collectionName}.schema.js`);
    try {
      await fs.access(filepath);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Parece no funcionar
  async getFacetValues(collectionName, fieldName, limit = 100) {
    const searchParameters = {
      q: '*', 
      facet_by: fieldName,
      max_facet_values: limit,
      per_page: 0
    };

    try {
      const result = await TypesenseClient.collections(collectionName).documents().search(searchParameters);

      console.log('Resultado de Typesense:', JSON.stringify(result, null, 2));
      
      // Buscar el facet específico en los resultados
      const facetData = result.facet_counts?.find(facet => facet.field_name === fieldName);

      return facetData?.counts?.map(entry => ({
        value: entry.value,
        label: entry.value,
        count: entry.count // Incluir el conteo también
      })) || [];
      
    } catch (error) {
      console.error(`Error fetching facet values for ${fieldName} in ${collectionName}:`, error.message);
      return [];
    }
  }

  async loadSchemaModule(collectionName) {
    // Usar el registro de mapeo si existe, sino usar el nombre original
    const actualSchemaName = schemaRegistry[collectionName] || collectionName;

    const schemaSubDir = path.join(this.schemaDir, actualSchemaName);
    const filePath = path.join(schemaSubDir, `${actualSchemaName}.schema.js`);
    const schemaUrl = pathToFileURL(filePath).href;
    try {
      const schemaModule = await import(schemaUrl);
      return schemaModule;
    } catch (error) {
      console.error(`❌ Error cargando el esquema para '${collectionName}': ${error.message}`);
      return null;
    }
  }

  async countDocuments(collectionName) {
    try {
      const schemaModule = await this.loadSchemaModule(collectionName);

      if (!schemaModule || !schemaModule.default) {
        console.error(`❌ No se encontró el esquema para '${collectionName}'`);
        return;
      }

      const schema = schemaModule.default;
      const collection = await TypesenseClient.collections(collectionName).retrieve();

      console.log(`ℹ️ Número de documentos: ${collection.num_documents} | colección: '${collectionName}'`);
    } catch (error) {
      console.error(`❌ Error refrescando la colección '${collectionName}':`, error.message);
    }
  }
 

}