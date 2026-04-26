import fs from 'fs/promises';
import { createReadStream } from 'fs';
import readline from 'readline';
import { parse } from 'csv-parse';
import stream from 'stream';
import path from 'path';
import { fileURLToPath } from 'url'

// Funciones equivalentes a las de Files.php en PHP 
class CSVManager {
    /*
        Para habilitar campos faltantes crear un transformer que maneje el campo ausente (definitions.json)

        Ej:

        {
            "idField": "USER_ID",
            "required": [
                {"field": "USER_ID", "type": "number"},
                // ..
            ],
            "optional": [
                {"field": "ENCUESTA DE CALIDAD", "type": "number", "default": 0}
            ]
        }
    */
    static options = {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // Permite diferente número de campos
        skip_lines_with_error: true // Omite líneas con errores
    };

    static setOptions(options) {
        this.options = { ...this.options, ...options };
    }

    /**
     * Detecta el separador CSV de una línea de muestra
     * @param {string} line Primera línea del archivo CSV
     * @returns {string} El carácter separador detectado
     * @throws {Error} Si no se puede determinar el separador de forma fiable
     */
    static detectSeparator(line) {
        // Contadores para posibles separadores
        const counts = {};

        // Analizar cada carácter de la línea
        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            // Excluir caracteres alfanuméricos, guiones, guiones bajos y letras Unicode
            if (/[a-zA-Z0-9_\-\p{L}]/u.test(char)) {
                continue;
            }

            // Contabilizar el carácter
            if (!counts[char]) {
                counts[char] = 0;
            }
            counts[char]++;
        }

        if (Object.keys(counts).length === 0) {
            throw new Error("Cannot determine CSV separator automatically. No candidates found.");
        }

        // Filtrar solo los que aparecen más de una vez
        const candidates = {};
        Object.entries(counts).forEach(([char, count]) => {
            if (count > 1) {
                candidates[char] = count;
            }
        });

        if (Object.keys(candidates).length === 0) {
            // Si ninguno se repite, tomar el que más aparece aunque sea solo 1 vez
            const chars = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
            return chars[0];
        }

        // Si hay uno claramente más frecuente, tomarlo
        const sortedChars = Object.keys(candidates).sort((a, b) => candidates[b] - candidates[a]);
        const max = candidates[sortedChars[0]];

        // Verificar si hay empate
        const topWithSameFreq = {};
        Object.entries(candidates).forEach(([char, count]) => {
            if (count === max) {
                topWithSameFreq[char] = count;
            }
        });

        if (Object.keys(topWithSameFreq).length > 1) {
            throw new Error("Cannot determine CSV separator automatically. Multiple candidates found: " + Object.keys(topWithSameFreq).join(','));
        }

        return Object.keys(topWithSameFreq)[0];
    }

    /**
   * Parsea un archivo CSV a un array, con cabecera opcional, detección automática del separador,
   * y soporte para procesar desde una línea de inicio y un límite de filas.
   * @param {string} path Ruta al archivo CSV
   * @param {string} separator Separador de campos (por defecto: "AUTO" para autodetectar)
   * @param {boolean} header Si la primera línea es cabecera (por defecto: true)
   * @param {boolean} assoc Devolver arrays asociativos usando cabeceras como claves (por defecto: true)
   * @param {number} startLine Línea desde la que empezar a recoger datos (por defecto: 0)
   * @param {number|boolean} limit Máximo número de filas a devolver (por defecto: false = sin límite)
   * @returns {Promise<{ header: string[], rows: Array }>} Objeto con `header` y `rows`
   * 
   * @example
        // Ruta al archivo CSV
        const filePath = "D:\\Desktop\\PALITO PRJ\\DATABASE\\sucursales.csv";

        // Procesar el archivo CSV
        // Se detecta automáticamente el separador, se incluye la cabecera,
        // se devuelven objetos asociativos y se procesan desde la 2da línea de datos
        // con un límite de 2 filas.

        // Sólo primeros 2 registros
        const result = await CSVManager.getCSV(
            filePath,
            'AUTO',   // detecta separador
            true,     // incluye cabecera
            true,     // devuelve objetos asociativos
            1,        // desde la 2da línea de datos
            2         // máximo 2 filas
        );
        
        console.log('header', result.header);
        console.log('rows', result.rows);
   */
    static async getCSV(
        path,
        separator = "AUTO",
        header = true,
        assoc = true,
        startLine = 0,
        limit = false
    ) {
        // Leer primera línea para detectar separador
        const firstLineStream = createReadStream(path, { encoding: 'utf8' });
        const firstLineReader = readline.createInterface({
            input: firstLineStream,
            crlfDelay: Infinity
        });
        let firstLine = '';
        for await (const line of firstLineReader) {
            firstLine = line;
            break;
        }
        firstLineStream.destroy();

        if (separator === 'AUTO') {
            separator = this.detectSeparator(firstLine);
        }

        // Leer todo el contenido
        const content = await fs.readFile(path, 'utf8');
        const lines = content.replace(/\r\n|\r/g, '\n').split('\n');

        // Prepara cabecera y rows
        let cabecera = [];
        const rows = [];
        let processedCount = 0;

        if (header) {
            cabecera = this.parseCSVLine(lines[0], separator).map(field => this.sanitize(field));
        }

        // Índice real de inicio
        const dataStart = (header ? 1 : 0) + startLine;

        for (let i = dataStart; i < lines.length; i++) {
            const raw = lines[i];
            if (!raw.trim()) continue;

            const data = this.parseCSVLine(raw, separator);

            let row;
            if (assoc && header) {
                row = {};
                for (let j = 0; j < cabecera.length; j++) {
                    row[cabecera[j]] = data[j] !== undefined ? data[j] : '';
                }
            } else {
                row = data;
            }

            rows.push(row);
            processedCount++;

            // Verificar el límite
            if (limit !== false && processedCount >= limit) {
                break;
            }
        }

        return {
            header: cabecera,
            rows: rows
        };
    }

    /**
     * Procesa un archivo CSV línea por línea
     * @param {string} path Ruta al archivo CSV
     * @param {string} separator Separador de campos
     * @param {boolean} header Si la primera línea es cabecera
     * @param {Function} fn Función a ejecutar para cada fila
     * @param {Array|Object} headerDefs Definiciones personalizadas de cabecera
     * @param {number} startLine Línea desde la que empezar a procesar
     * @param {number|boolean} limit Límite de filas a procesar
     * @param {boolean} replaceSpaces Reemplazar espacios en nombres de cabecera
     * @param {boolean} lowercase Convertir cabeceras a minúsculas
     * @returns {Promise<void>}
     * 
     * @example
     *     
        // Callback que imprime cada fila
        const imprimirFila = (row) => {
        console.log(row);
        };
        
        // Función para procesar el CSV
        const procesarConCallback = async () => {
        try {
            console.log("=== Procesando con processCSV ===");
            await CSVManager.processCSV(
            filePath,      // Ruta al archivo CSV
            'AUTO',        // Detecta automáticamente el separador
            true,          // La primera línea es la cabecera
            imprimirFila,  // Callback que imprime cada fila
            null,          // Sin definiciones personalizadas de cabecera
            0,             // Comienza desde la primera línea de datos
            false,         // Sin límite, procesa todas las filas
            true,          // Reemplaza espacios en cabeceras por guiones
            true           // Convierte cabeceras a minúsculas
            );
            console.log("=== Fin del procesamiento ===");
        } catch (error) {
            console.error('Error:', error);
        }
        };
        
        // Ejecutar la función
        procesarConCallback();
     */
    static async processCSV(path, separator, header, fn, headerDefs = null, startLine = 0, limit = false, replaceSpaces = true, lowercase = false) {
        const fileStream = createReadStream(path, { encoding: 'utf8' });
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let cabecera = [];
        let lineCount = 0;
        let processedCount = 0;
        let assoc = false;

        // Para detectar automáticamente el separador
        if (separator === 'AUTO') {
            for await (const line of rl) {
                separator = this.detectSeparator(line);
                // Reiniciar el stream después de detectar el separador
                rl.close();
                fileStream.destroy();

                // Crear un nuevo stream para procesar desde el principio
                const newFileStream = createReadStream(path, { encoding: 'utf8' });
                const newRl = readline.createInterface({
                    input: newFileStream,
                    crlfDelay: Infinity
                });

                // Continuar con el flujo normal
                for await (const line of newRl) {
                    if (header && lineCount === 0) {
                        cabecera = this.parseCSVLine(line, separator);
                        cabecera = cabecera.map(field => this.sanitize(field));

                        if (lowercase) {
                            cabecera = cabecera.map(field => field.toLowerCase());
                        }

                        if (replaceSpaces) {
                            cabecera = cabecera.map(field => field.replace(/ /g, '-'));
                        }

                        assoc = true;
                        lineCount++;
                        continue;
                    }

                    // Saltarse líneas hasta startLine
                    if (lineCount < startLine) {
                        lineCount++;
                        continue;
                    }

                    // Aplicar headerDefs si existen
                    if (headerDefs !== null) {
                        assoc = true;

                        if (cabecera && cabecera.length > 0) {
                            if (typeof headerDefs === 'object' && !Array.isArray(headerDefs)) {
                                cabecera = cabecera.map(key => headerDefs[key] || key);
                            } else if (Array.isArray(headerDefs)) {
                                cabecera = headerDefs;
                            }
                        } else {
                            cabecera = headerDefs;
                        }
                    }

                    const data = this.parseCSVLine(line, separator);

                    // Saltarse líneas vacías
                    let isEmpty = true;
                    for (const val of data) {
                        if (val && val.trim()) {
                            isEmpty = false;
                            break;
                        }
                    }

                    if (isEmpty) {
                        lineCount++;
                        continue;
                    }

                    let row;
                    if (assoc) {
                        row = {};
                        for (let j = 0; j < cabecera.length; j++) {
                            const headKey = cabecera[j];
                            const val = data[j] !== undefined ? data[j] : '';
                            row[headKey] = val;
                        }
                    } else {
                        row = data;
                    }

                    // Ejecutar el callback
                    await fn(row);

                    processedCount++;
                    lineCount++;

                    // Verificar el límite
                    if (limit !== false && limit !== null && processedCount >= limit) {
                        break;
                    }
                }

                newRl.close();
                newFileStream.destroy();
                return;
            }
        } else {
            // Proceso normal sin detección automática
            for await (const line of rl) {
                if (header && lineCount === 0) {
                    cabecera = this.parseCSVLine(line, separator);
                    cabecera = cabecera.map(field => this.sanitize(field));

                    if (lowercase) {
                        cabecera = cabecera.map(field => field.toLowerCase());
                    }

                    if (replaceSpaces) {
                        cabecera = cabecera.map(field => field.replace(/ /g, '-'));
                    }

                    assoc = true;
                    lineCount++;
                    continue;
                }

                // Saltarse líneas hasta startLine
                if (lineCount < startLine) {
                    lineCount++;
                    continue;
                }

                // Aplicar headerDefs si existen
                if (headerDefs !== null) {
                    assoc = true;

                    if (cabecera && cabecera.length > 0) {
                        if (typeof headerDefs === 'object' && !Array.isArray(headerDefs)) {
                            cabecera = cabecera.map(key => headerDefs[key] || key);
                        } else if (Array.isArray(headerDefs)) {
                            cabecera = headerDefs;
                        }
                    } else {
                        cabecera = headerDefs;
                    }
                }

                const data = this.parseCSVLine(line, separator);

                // Saltarse líneas vacías
                let isEmpty = true;
                for (const val of data) {
                    if (val && val.trim()) {
                        isEmpty = false;
                        break;
                    }
                }

                if (isEmpty) {
                    lineCount++;
                    continue;
                }

                let row;
                if (assoc) {
                    row = {};
                    for (let j = 0; j < cabecera.length; j++) {
                        const headKey = cabecera[j];
                        const val = data[j] !== undefined ? data[j] : '';
                        row[headKey] = val;
                    }
                } else {
                    row = data;
                }

                // Ejecutar el callback
                await fn(row);

                processedCount++;
                lineCount++;

                // Verificar el límite
                if (limit !== false && limit !== null && processedCount >= limit) {
                    break;
                }
            }
        }

        rl.close();
        fileStream.destroy();
    }

    /**
     * Parsea una línea CSV respetando comillas
     * @param {string} line Línea CSV
     * @param {string} delimiter Separador
     * @returns {Array} Array con los campos de la línea
     */
    static parseCSVLine(line, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"' && !inQuotes) {
                inQuotes = true;
                continue;
            }

            if (char === '"' && inQuotes) {
                if (nextChar === '"') {
                    current += '"';
                    i++; // Saltar el próximo caracter
                } else {
                    inQuotes = false;
                }
                continue;
            }

            if (char === delimiter && !inQuotes) {
                result.push(current);
                current = '';
                continue;
            }

            current += char;
        }

        // Añadir el último campo
        result.push(current);

        return result;
    }

    /**
     * Sanitiza un string (reemplazar por la implementación equivalente a Strings::sanitize)
     * @param {string} str String a sanitizar
     * @returns {string} String sanitizado
     */
    static sanitize(str) {
        // Implementación básica, ajusta según tus necesidades
        return str.trim();
    }

    static async getFirstLine(filePath) {
        const fileStream = createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            rl.close();
            fileStream.destroy();
            return line;
        }
        return '';
    }

    /**
     * Escribe un array de objetos JavaScript (exporta) a un archivo CSV.
     * Los valores de tipo string serán envueltos en comillas dobles.
     * @param {string} filePath La ruta absoluta del archivo CSV a escribir.
     * @param {Array<Object>} data Un array de objetos JavaScript con los datos a escribir.
     * @param {string} separator El separador de campos a utilizar (por defecto: ',').
     * @returns {Promise<void>}
     */
    static async writeCSV(filePath, data, separator = ',') {
        if (!data || data.length === 0) {
            await fs.writeFile(filePath, '');
            return;
        }

        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Añadir cabeceras (siempre envueltas en comillas)
        csvRows.push(headers.map(header => `"${header}"`).join(separator));

        // Añadir filas de datos
        data.forEach(row => {
            const values = headers.map(header => {
                let value = row[header];
                
                if (value === undefined || value === null) {
                    return '';
                } else if (typeof value === 'string') {
                    // Escapar comillas dobles duplicándolas y envolver en comillas
                    const escapedValue = value.replace(/"/g, '""');
                    return `"${escapedValue}"`;
                } else {
                    // Para números, booleanos y otros tipos, convertir a string sin comillas
                    return String(value);
                }
            });
            csvRows.push(values.join(separator));
        });

        const csvContent = csvRows.join('\n');
        await fs.writeFile(filePath, csvContent, 'utf-8');
    }

    /**
      * Imports CSV data to a Firestore collection
      * @param {string} filePath - Path to the CSV file
      * @param {string} to - Firestore collection name
      * @param {string} transformerPath - Optional path to transformer file
      * @param {boolean} dryRun - Whether to perform a dry run (no writes)
      * @param {boolean} verbose - Whether to log verbose output
      * @param {object} db - Firestore database instance
      * @param {string} idField - Optional ID field name
      * @param {boolean} force - Whether to force import ignoring config warnings
      * @param {boolean} removeIdField - Remove duplicate "id field" using just the native "id" field of Firebase collections
      * @param {string} tenant_id - Tenant ID for composite IDs
      * @param {number} limit - Maximum number of rows to process (optional)
      * @param {number} offset - Number of rows to skip (optional)
      * @param {string} customDefsFile - Custom definitions file path (optional)
      * @param {string} customTrsfFile - Custom transformer file path (optional)
      * @param {number} batchSize - Process records in batches of N size (optional)
      * @param {boolean} withTimestamps - Whether to add created_at, updated_at, deleted_at timestamps (optional)
    */
    static async importCSV(filePath, to, transformerPath, dryRun, verbose, db, idField, force, removeIdField, tenant_id, parentKey = null, limit = null, offset = 0, customDefsFile = null, customTrsfFile = null, batchSize = null, withTimestamps = false) {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);

            // Parsear la opción --to para soportar subcolecciones
            const [parentCollection, subCollection] = to.split('.');
            if (!parentCollection) {
                throw new Error('Invalid --to format. Must specify a collection');
            }
            const isSubCollection = !!subCollection;
            if (isSubCollection && !parentKey && !force) {
                throw new Error('Must specify --parent-key when importing to a subcollection, or use --force to skip parent validation');
            }

            // **Rutas base para archivos de configuración**
            const configBasePath = path.join(__dirname, '../config/import', to);
            
            //  Priorizar archivos personalizados**
            let requiredFieldsPath, transformerFilePath;
            
            // === MANEJO DE DEFINITIONS FILE ===
            if (customDefsFile) {
                // Si se especifica un archivo personalizado, construir la ruta
                requiredFieldsPath = path.isAbsolute(customDefsFile) 
                    ? customDefsFile 
                    : path.join(configBasePath, customDefsFile);
                if (verbose) console.log(`🔧 Using custom definitions file: ${customDefsFile}`);
            } else {
                // Usar la ruta por defecto
                requiredFieldsPath = path.join(configBasePath, 'definitions.json');
                if (verbose) console.log(`📋 Using default definitions file: definitions.json`);
            }

            // === MANEJO DE TRANSFORMER FILE ===
            if (customTrsfFile) {
                // Si se especifica un transformador personalizado, construir la ruta
                if (path.isAbsolute(customTrsfFile)) {
                    transformerFilePath = customTrsfFile;
                } else {
                    // Si no incluye la carpeta transformers, agregarla automáticamente
                    if (!customTrsfFile.includes('transformers/')) {
                        transformerFilePath = path.join(configBasePath, 'transformers', customTrsfFile);
                    } else {
                        transformerFilePath = path.join(configBasePath, customTrsfFile);
                    }
                }
                if (verbose) console.log(`🔧 Using custom transformer file: ${customTrsfFile}`);
            } else {
                // Usar la ruta por defecto
                transformerFilePath = path.join(configBasePath, 'transformers/default.json');
                if (verbose) console.log(`🔄 Using default transformer file: transformers/default.json`);
            }

            // **Verificar y cargar archivo de definiciones**
            let config = null;
            let configIdField = null;
            let configExists = false;

            try {
                await fs.access(requiredFieldsPath);
                const configContent = await fs.readFile(requiredFieldsPath, 'utf8');
                config = JSON.parse(configContent);
                configExists = true;

                // Verificar si hay un idField en la configuración
                if (config.idField) {
                    configIdField = config.idField;
                    if (!idField) {
                        idField = configIdField;
                        if (verbose) console.log(`🔑 Using ID field '${idField}' from config for duplicate prevention`);
                    }
                }

                // Validar estructura de la configuración
                if (!config.required || !Array.isArray(config.required)) {
                    console.warn('⚠️ Warning: Invalid config file structure. "required" array is missing or not an array.');
                }

                if (verbose) console.log(`✅ Loaded config from ${requiredFieldsPath}`);
            } catch (e) {
                if (customDefsFile) {
                    // Si se especificó un archivo personalizado pero no existe, es un error
                    throw new Error(`❌ Custom definitions file not found: ${requiredFieldsPath}`);
                }
                if (verbose) console.log('📝 No definitions.json found, using default behavior');
            }

            // **Advertencia si no hay idField definido**
            if (!idField) {
                console.log('⚠️ No ID field specified for duplicate prevention. All records will be imported.');
            } else if (verbose) {
                console.log(`Using '${idField}' as ID field for duplicate prevention`);
            }

            // **Manejo del transformer**
            let transformer = null;
            let separator = ','; // Separador por defecto

            if (customTrsfFile) {
                try {
                    await fs.access(transformerFilePath);
                    const transformerContent = await fs.readFile(transformerFilePath, 'utf8');
                    transformer = JSON.parse(transformerContent);
                    if (verbose) console.log('✅ Loaded transformer from custom file');
                } catch (e) {
                    console.error(`❌ Error loading custom transformer file '${transformerFilePath}': ${e.message}`);
                    return;
                }
            }
            else if (transformerPath) {
                try {
                    const transformerContent = await fs.readFile(transformerPath, 'utf8');
                    transformer = JSON.parse(transformerContent);
                    if (verbose) console.log('Using provided transformer');
                } catch (e) {
                    console.error(`Error loading transformer: ${e.message}`);
                    return;
                }
            } else {
                const defaultTransformerPath = path.join(configBasePath, 'transformers/default.json');
                try {
                    await fs.access(defaultTransformerPath);
                    const transformerContent = await fs.readFile(defaultTransformerPath, 'utf8');
                    transformer = JSON.parse(transformerContent);
                    if (verbose) console.log('Using default transformer');
                } catch (e) {
                    if (verbose) console.log('No transformer found, using direct field mapping');
                }
            }

            // **Ajustar idField según el transformer**
            let transformedIdField = idField;
            if (transformer && transformer.mappings && idField) {
                const mappingEntry = Object.entries(transformer.mappings).find(([source]) => source === idField);
                if (mappingEntry) {
                    transformedIdField = mappingEntry[1];
                    if (verbose) console.log(`ID field '${idField}' mapped to '${transformedIdField}' via transformer`);
                } else {
                    if (verbose) console.log(`ID field '${idField}' not found in transformer mappings, using original name`);
                }
            }

            // **Configurar el separador**
            if (transformer && transformer.field_separator) {
                separator = transformer.field_separator;
                if (verbose) console.log(`Using separator '${separator}' from transformer`);
            } else {
                // Detectar automáticamente el separador si no está especificado
                const firstLine = await this.getFirstLine(filePath);
                try {
                    separator = this.detectSeparator(firstLine);
                    if (verbose) console.log(`Detected separator '${separator}' automatically`);
                } catch (e) {
                    console.error(`Failed to detect separator: ${e.message}. Using default ','`);
                }
            }

            // Parsear el archivo CSV con limit y offset
            console.log(`📊 Processing CSV file: ${filePath}`);
            const { header, rows } = await this.getCSV(
                filePath,
                separator,
                true,  // header = true
                true,  // assoc = true
                offset || 0,  // Número de filas a saltar (0 si no se especifica)
                limit || false  // Límite de filas (false = sin límite si no se especifica)
            );

            if (rows.length === 0) {
                console.error('❌ No records found in CSV file with the specified offset/limit');
                return;
            }

            // **Actualizar opciones del parser con el separador**
            CSVManager.setOptions({ delimiter: separator });

            console.log(`📋 Found ${rows.length} records in CSV file`);

            // **Procesar e importar registros**
            const collection = db.collection(parentCollection);
            let importedCount = 0;
            let errorCount = 0;

            if (batchSize && batchSize > 0) {
                // **Procesamiento por lotes**
                console.log(`🚀 Using batch processing with size: ${batchSize}`);
                
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize);
                    const batchNumber = Math.floor(i / batchSize) + 1;
                    const totalBatches = Math.ceil(rows.length / batchSize);
                    
                    if (verbose) console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
                    
                    const result = await this.processBatch(
                        batch, 
                        db, 
                        collection, 
                        parentCollection, 
                        subCollection, 
                        isSubCollection,
                        transformer, 
                        tenant_id, 
                        transformedIdField, 
                        removeIdField, 
                        parentKey, 
                        force, 
                        dryRun, 
                        verbose,
                        withTimestamps
                    );
                    
                    importedCount += result.imported;
                    errorCount += result.errors;
                }
            } else {
                // **Procesamiento individual (comportamiento original)**
                for (const record of rows) {
                    try {
                        let transformedRecord = transformer ? this.transformRecord(record, transformer, tenant_id) : record;
                        let docId = transformedIdField && transformedRecord[transformedIdField] ? transformedRecord[transformedIdField] : null;

                        if (removeIdField && transformedIdField && transformedRecord.hasOwnProperty(transformedIdField)) {
                            delete transformedRecord[transformedIdField];
                            if (verbose) console.log(`Removed field '${transformedIdField}' from record with ID: ${docId}`);
                        }

                        // Agregar timestamps si withTimestamps está activo
                        if (withTimestamps) {
                            const now = new Date();
                            
                            // Para la colección 'users', no agregar created_at porque Firebase lo maneja con creationTime
                            if (parentCollection !== 'users') {
                                transformedRecord.created_at = now;
                            }
                            
                            transformedRecord.updated_at = null; // Al crear, updated_at es null
                            transformedRecord.deleted_at = null; // Al crear, deleted_at es null
                            
                            if (verbose) {
                                console.log(`Added timestamps to record with ID: ${docId || 'auto-generated'}`);
                            }
                        }

                        if (isSubCollection) {
                            const parentId = record[parentKey];
                            if (!parentId) {
                                throw new Error(`Parent key '${parentKey}' not found in record`);
                            }

                            const parentDocRef = collection.doc(parentId);
                            const subCollectionRef = parentDocRef.collection(subCollection);

                            // Validar existencia del padre (a menos que se use --force)
                            if (!force) {
                                const parentDoc = await parentDocRef.get();
                                if (!parentDoc.exists) {
                                    throw new Error(`Parent document '${parentId}' does not exist in '${parentCollection}'`);
                                }
                            }

                            if (dryRun && verbose) {
                                console.log(`Would create document in ${parentCollection}/${parentId}/${subCollection}:`);
                                console.log(`Document ID: ${docId || 'auto-generated'}`);
                                console.dir(transformedRecord, { depth: null });
                                console.log('');
                            }

                            if (!dryRun) {
                                if (docId) {
                                    const docRef = subCollectionRef.doc(docId);
                                    if (verbose) {
                                        const docSnapshot = await docRef.get();
                                        if (docSnapshot.exists) {
                                            console.log(`Overwriting existing record with ID: ${docId} in ${parentCollection}/${parentId}/${subCollection}`);
                                        } else {
                                            console.log(`Creating new record with ID: ${docId} in ${parentCollection}/${parentId}/${subCollection}`);
                                        }
                                    }
                                    await docRef.set(transformedRecord);
                                } else {
                                    await subCollectionRef.add(transformedRecord);
                                }
                            }
                        } else {
                            if (dryRun && verbose) {
                                console.log(`Would create document in ${parentCollection}:`);
                                console.log(`Document ID: ${docId || 'auto-generated'}`);
                                console.dir(transformedRecord, { depth: null });
                                console.log('');
                            }

                            if (!dryRun) {
                                if (docId) {
                                    const docRef = collection.doc(docId);
                                    if (verbose) {
                                        const docSnapshot = await docRef.get();
                                        if (docSnapshot.exists) {
                                            console.log(`Overwriting existing record with ID: ${docId}`);
                                        } else {
                                            console.log(`Creating new record with ID: ${docId}`);
                                        }
                                    }
                                    await docRef.set(transformedRecord);
                                } else {
                                    await collection.add(transformedRecord);
                                }
                            }
                        }

                        importedCount++;
                        if (verbose && !dryRun) {
                            console.log(`Processed record ${importedCount}:`, docId ? `ID ${docId}` : 'Auto-generated ID');
                        }
                    } catch (e) {
                        errorCount++;
                        console.error(`Error processing record: ${e.message}`);
                    }
                }
            }

            // Resumen de la importación
            console.log('\n📊 Import Summary:');
            console.log(`✅ Total records processed: ${rows.length}`);
            console.log(`✅ Records imported: ${importedCount}`);
            if (errorCount > 0) console.log(`❌ Records with errors: ${errorCount}`);
            if (dryRun) console.log('🔍 DRY RUN: No data was actually imported');
            if (offset || limit) {
                console.log(`📏 Processed with offset=${offset || 0}, limit=${limit || 'none'}`);
            }
            if (batchSize && batchSize > 0) {
                console.log(`📦 Processed using batches of ${batchSize} records`);
            }

        } catch (error) {
            console.error(`❌ CSV import failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process a batch of records using Firebase batch writes
     * @param {Array} batch - Batch of records to process
     * @param {object} db - Firebase database instance
     * @param {object} collection - Firebase collection reference
     * @param {string} parentCollection - Parent collection name
     * @param {string} subCollection - Sub collection name (optional)
     * @param {boolean} isSubCollection - Whether processing a subcollection
     * @param {object} transformer - Transformer configuration
     * @param {string} tenant_id - Tenant ID
     * @param {string} transformedIdField - Transformed ID field name
     * @param {boolean} removeIdField - Whether to remove ID field
     * @param {string} parentKey - Parent key for subcollections
     * @param {boolean} force - Force processing
     * @param {boolean} dryRun - Dry run mode
     * @param {boolean} verbose - Verbose logging
     * @param {boolean} withTimestamps - Whether to add timestamps to records
     * @returns {Promise<{imported: number, errors: number}>} - Processing result
     */
    static async processBatch(batch, db, collection, parentCollection, subCollection, isSubCollection, transformer, tenant_id, transformedIdField, removeIdField, parentKey, force, dryRun, verbose, withTimestamps = false) {
        let imported = 0;
        let errors = 0;
        
        if (dryRun) {
            // In dry run mode, just process without writing
            for (const record of batch) {
                try {
                    let transformedRecord = transformer ? this.transformRecord(record, transformer, tenant_id) : record;
                    let docId = transformedIdField && transformedRecord[transformedIdField] ? transformedRecord[transformedIdField] : null;

                    if (removeIdField && transformedIdField && transformedRecord.hasOwnProperty(transformedIdField)) {
                        delete transformedRecord[transformedIdField];
                    }

                    // Agregar timestamps si withTimestamps está activo
                    if (withTimestamps) {
                        const now = new Date();
                        
                        // Para la colección 'users', no agregar created_at porque Firebase lo maneja con creationTime
                        if (parentCollection !== 'users') {
                            transformedRecord.created_at = now;
                        }
                        
                        transformedRecord.updated_at = null; // Al crear, updated_at es null
                        transformedRecord.deleted_at = null; // Al crear, deleted_at es null
                    }

                    if (verbose) {
                        console.log(`Would create document: ${docId || 'auto-generated'}`);
                        console.dir(transformedRecord, { depth: null });
                    }
                    imported++;
                } catch (e) {
                    errors++;
                    console.error(`Error processing record in batch: ${e.message}`);
                }
            }
            return { imported, errors };
        }

        // Create Firebase batch
        const firebaseBatch = db.batch();
        const batchOperations = [];

        // Prepare all batch operations
        for (const record of batch) {
            try {
                let transformedRecord = transformer ? this.transformRecord(record, transformer, tenant_id) : record;
                let docId = transformedIdField && transformedRecord[transformedIdField] ? transformedRecord[transformedIdField] : null;

                if (removeIdField && transformedIdField && transformedRecord.hasOwnProperty(transformedIdField)) {
                    delete transformedRecord[transformedIdField];
                    if (verbose) console.log(`Removed field '${transformedIdField}' from record with ID: ${docId}`);
                }

                // Agregar timestamps si withTimestamps está activo
                if (withTimestamps) {
                    const now = new Date();
                    
                    // Para la colección 'users', no agregar created_at porque Firebase lo maneja con creationTime
                    if (parentCollection !== 'users') {
                        transformedRecord.created_at = now;
                    }
                    
                    transformedRecord.updated_at = null; // Al crear, updated_at es null
                    transformedRecord.deleted_at = null; // Al crear, deleted_at es null
                    
                    if (verbose) {
                        console.log(`Added timestamps to record with ID: ${docId || 'auto-generated'}`);
                    }
                }

                if (isSubCollection) {
                    const parentId = record[parentKey];
                    if (!parentId) {
                        throw new Error(`Parent key '${parentKey}' not found in record`);
                    }

                    const parentDocRef = collection.doc(parentId);
                    const subCollectionRef = parentDocRef.collection(subCollection);

                    // For batch processing, we skip the parent existence check for performance
                    // Users can use --force if they want to bypass validation
                    if (!force) {
                        console.warn(`⚠️ Warning: Parent existence validation skipped in batch mode for ${parentId}. Use --force to suppress this warning.`);
                    }

                    let docRef;
                    if (docId) {
                        docRef = subCollectionRef.doc(docId);
                    } else {
                        docRef = subCollectionRef.doc(); // Auto-generate ID
                    }

                    firebaseBatch.set(docRef, transformedRecord);
                    batchOperations.push({ docId: docId || docRef.id, parentId, isSubCollection: true });
                } else {
                    let docRef;
                    if (docId) {
                        docRef = collection.doc(docId);
                    } else {
                        docRef = collection.doc(); // Auto-generate ID
                    }

                    firebaseBatch.set(docRef, transformedRecord);
                    batchOperations.push({ docId: docId || docRef.id, isSubCollection: false });
                }

                imported++;
            } catch (e) {
                errors++;
                console.error(`Error preparing batch operation: ${e.message}`);
            }
        }

        // Execute the batch
        if (batchOperations.length > 0) {
            try {
                await firebaseBatch.commit();
                if (verbose) {
                    console.log(`✅ Successfully committed batch with ${batchOperations.length} operations`);
                }
            } catch (batchError) {
                console.error(`❌ Batch commit failed: ${batchError.message}`);
                errors += batchOperations.length;
                imported -= batchOperations.length;
            }
        }

        return { imported, errors };
    }

    /**
     * Parse CSV file and return records
     * @param {string} filePath - Path to CSV file
     * @returns {Promise<Array>} - Parsed records
     */
    static parseCSV(filePath) {
        return new Promise((resolve, reject) => {
            const records = [];
            createReadStream(filePath)
                .pipe(parse(CSVManager.options))
                .on('data', (record) => {
                    records.push(record);
                })
                .on('error', (error) => {
                    reject(error);
                })
                .on('end', () => {
                    resolve(records);
                });
        });
    }

    /**
     * Transform record using mapping and transform rules
     * @param {Object} record - Original record
     * @param {Object} transformer - Transformer config
     * @returns {Object} - Transformed record
     */
    static transformRecord(record, transformer, tenant_id) {
        const result = {};

        // Apply field mappings
        if (transformer.mappings) {
            for (const [sourceField, targetField] of Object.entries(transformer.mappings)) {
                if (record[sourceField] !== undefined) {
                    result[targetField] = record[sourceField];
                }
            }
        } else {
            Object.assign(result, record);
        }

        // Aplicar transformaciones
        if (transformer.transform) {
            for (const [field, transformFnStr] of Object.entries(transformer.transform)) {
                try {
                    // Pasar el registro completo como tercer parámetro
                    if (result[field] !== undefined) {
                        const fn = new Function('value', 'tenant_id', 'data', `return (${transformFnStr})(value, tenant_id, data);`);
                        result[field] = fn(result[field], tenant_id, result); // Cambio aquí
                    } else {
                        // Pasar el registro completo como tercer parámetro
                        const fn = new Function('value', 'tenant_id', 'data', `return (${transformFnStr})(value, tenant_id, data);`);
                        result[field] = fn(undefined, tenant_id, result); // Cambio aquí
                    }
                } catch (e) {
                    console.error(`Error applying transform to field '${field}': ${e.message}`);
                }
            }
        }

        return result;
    }
}

export default CSVManager;