import admin from 'firebase-admin';
import fs from 'fs/promises';

import { FirebaseServiceAccount } from './FirebaseServiceAccount.js';

export class Firebase {
    constructor(serviceAccount, connect = true) {
        this._serviceAccount = serviceAccount;
        this._firebaseService = new FirebaseServiceAccount(serviceAccount, connect);
        this._db = this._firebaseService._db;
        this._firebaseService.initializeFirebase();
    }

    // Propiedad para acceder a la base de datos
    get db() {
        return this._firebaseService._db;
    }

    async getAllValues(collection, field) {
        const snapshot = await this._db.collection(collection).select(field).limit(500).get();
        const values = new Set();
        
        snapshot.forEach(doc => {
            const val = doc.get(field);
            if (val) values.add(val);
        });
        
        return [...values].map(v => ({ value: v, label: v }));
    }

    /*
        EXPORTAR SCHEMAS
    */

    async inferFieldTypes(docData) {
        const result = {};
        for (const key in docData) {
            const value = docData[key];
            if (value === null) { // Check for null first!
                result[key] = 'null';
            } else if (Array.isArray(value)) {
                result[key] = 'array';
            } else if (value instanceof admin.firestore.Timestamp) {
                result[key] = 'timestamp';
            } else if (value instanceof admin.firestore.DocumentReference) {
                result[key] = 'reference';
            } else if (typeof value === 'object') { // This will now correctly identify non-null objects as 'map'
                result[key] = 'map';
            } else {
                result[key] = typeof value;
            }
        }
        return result;
    }

    // Método auxiliar para determinar el tipo de un campo
    getFieldType(value) {
        // Primero, revisamos si es null.
        if (value === null) {
            return 'null';
        }

        // Verificamos si es una instancia de Timestamp ANTES de la revisión genérica de 'object'.
        if (value instanceof admin.firestore.Timestamp) {
            return 'timestamp';
        }

        // También podemos aprovechar para identificar otros tipos especiales de Firebase.
        if (value instanceof admin.firestore.GeoPoint) {
            return 'geopoint';
        }
        if (value instanceof admin.firestore.DocumentReference) {
            return 'reference';
        }

        // Verificamos si es un array.
        if (Array.isArray(value)) {
            return 'array';
        }

        // Ahora, las revisiones genéricas por `typeof`.
        const type = typeof value;
        if (type === 'string') return 'string';
        if (type === 'number') return 'number';
        if (type === 'boolean') return 'boolean';

        // Si es un 'object' pero no uno de los tipos especiales de arriba, lo tratamos como 'map'.
        if (type === 'object') {
            return 'map';
        }

        // Dejamos un tipo por defecto para cualquier otro caso.
        return 'unknown';
    };


  // Inferir tipos de campos a partir de múltiples documentos
  async inferFieldTypesFromDocs(docs) {
    const fieldTypes = {};
    const finalTypes = {};
    const allKeys = new Set();
    const nullableKeys = new Set(); // Almacena claves que han tenido al menos un valor nulo.
    
    // Recolectar todos los tipos observados para cada campo
    for (const doc of docs) {
      const docData = doc.data();
      for (const [key, value] of Object.entries(docData)) {
        allKeys.add(key); // Registramos todas las claves que existen.

        // Si el valor es null, marcamos la clave como "nulable".
        if (value === null) {
            nullableKeys.add(key);
        }

        if (!fieldTypes[key]) {
          fieldTypes[key] = new Set();
        }
        
        const type = this.getFieldType(value);
        fieldTypes[key].add(type);
      }
    }

    for (const [field, types] of Object.entries(fieldTypes)) {
        // console.log(`Field: ${field}, Types: ${[...types]}`); // Debugging line

        /*
            Si el campo termina con '_at', lo consideramos como un timestamp.
            Esto es útil para campos nulos no tienen un tipo definido distinto de null.
        */
        if (field.endsWith('_at')) {
            finalTypes[field] = 'timestamp';
            continue;
        }

        if (types.size === 1) {
            finalTypes[field] = [...types][0];
        } else if (types.has('timestamp')) {
            finalTypes[field] = 'timestamp'; // Priorizar timestamp sobre null
        } else if (types.has('null') && types.size >= 2) {
            // Si es null y otro tipo, elegir el no-null
            finalTypes[field] = [...types].find(t => t !== 'null');
        } else {
            finalTypes[field] = 'mixed';
        }
    }

    return finalTypes;
  }

    // Determinar campos requeridos (presentes en todos los documentos)
    getRequiredFields(docs) {
        if (docs.length === 0) return [];

        let commonFields = new Set(Object.keys(docs[0].data()));
        for (let i = 1; i < docs.length; i++) {
        const currentFields = new Set(Object.keys(docs[i].data()));
        commonFields = new Set([...commonFields].filter(x => currentFields.has(x)));
        }

        return [...commonFields];
    }

    // Generar el objeto de esquema
    async generateSchemaObject(collectionPath, depth = 0, limit = 10) {
        const schema = {
            fields: {},
            subcollections: {},
            required: {
                fields: [],
                subcollections: []
            }
        };

        // Obtener hasta 'limit' documentos
        const snapshot = await this.db.collection(collectionPath).limit(limit).get();
        const docs = snapshot.docs;

        if (docs.length === 0) {
            return schema;
        }

        // Inferir tipos de campos usando todos los documentos
        schema.fields = await this.inferFieldTypesFromDocs(docs);
        schema.required.fields = this.getRequiredFields(docs);

        // Recopilar subcolecciones únicas de TODOS los documentos
        const uniqueSubcollections = new Map();

        for (const doc of docs) {
            const docSubcollections = await doc.ref.listCollections();
            for (const sub of docSubcollections) {
                if (!uniqueSubcollections.has(sub.id)) {
                    uniqueSubcollections.set(sub.id, {
                        docId: doc.id,
                        subRef: sub
                    });
                }
            }
        }

        // Procesar cada subcolección única
        for (const [subId, { docId, subRef }] of uniqueSubcollections) {
            const subPath = `${collectionPath}/${docId}/${subId}`;
            const subSchema = await this.generateSchemaObject(subPath, depth + 1, limit);
            schema.subcollections[subId] = subSchema;
        }

        return schema;
    }

    // Método para procesar colecciones y subcolecciones recursivamente (adaptado de export_schema.js)
    async processCollection(path, output, depth = 0) {
        const indent = '  '.repeat(depth);
        const snapshot = await this.db.collection(path).limit(5).get();

        output.push(`${indent}- Collection: **${path}**`);

        for (const doc of snapshot.docs) {
            const docData = doc.data();
            const fieldTypes = await this.inferFieldTypes(docData);
            
            output.push(`${indent}  - Document (sample): ${doc.id}`);

            for (const [field, type] of Object.entries(fieldTypes)) {
                output.push(`${indent}    - ${field}: ${type}`);
            }

            // Procesar subcolecciones
            const subcollections = await doc.ref.listCollections();
            for (const sub of subcollections) {
                await this.processCollection(`${path}/${doc.id}/${sub.id}`, output, depth + 1);
            }
        }
    }

    // Método para exportar el esquema
    async exportSchema(collections = null) {
        const output = ['# Firestore Schema\n'];

        if (collections) {
            for (const col of collections) {
                await this.processCollection(col, output);
            }
            } else {
            const allCollections = await this.db.listCollections();
            for (const col of allCollections) {
                await this.processCollection(col.id, output);
            }
        }

        return output.join('\n');
    }

    async writeSchemaFile(content, outputFile, force = false) {
        try {
        await fs.access(outputFile);
        if (!force) {
            if (this.showWarnings) {
                console.log(`⚠️ El archivo ${outputFile} ya existe. Omitido`);
            }
            return false;
        }
        } catch (error) {
        // El archivo no existe, continuar
        }

        await fs.writeFile(outputFile, content, 'utf8');
        return true;
    }

}