import { SqlBaseCommand } from './SqlBaseCommand.js';

export class CopyCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'copy';
    this.description = 'Copia una tabla';
    this.examples = [
      'node com sql copy zippy.brands main.brands',
      'node com sql copy zippy.brands main.brands --confirm',
      'node com sql copy zippy.brands main.brands --confirm --limit=100',
      'node com sql copy zippy.brands main.brands --confirm --ignore-duplicates --limit=50',
      'node com sql copy zippy.brands main.brands --create_if_not_exists',
      'node com sql copy zippy.brands main.brands --create_if_not_exists --limit=10'
    ];
  }

  static get config() {
    return {
      positional: ['source', 'destination'],
      optionalArgs: ['confirm', 'ignore-duplicates', 'limit', 'create_if_not_exists'],
      validation: {},
      options: {
        source: {
          describe: 'Origen en formato {conexion}.{tabla}',
          type: 'string'
        },
        destination: {
          describe: 'Destino en formato {conexion}.{tabla}',
          type: 'string'
        },
        confirm: {
          describe: 'Confirmar la operación si la tabla destino tiene datos',
          type: 'boolean',
          default: false
        },
        'ignore-duplicates': {
          describe: 'Ignorar duplicados basados en la primary key',
          type: 'boolean',
          default: false
        },
        limit: {
          describe: 'Número máximo de registros a copiar (para pruebas)',
          type: 'number'
        },
        'create_if_not_exists': {
          describe: 'Crear la tabla destino si no existe',
          type: 'boolean',
          default: false
        }
      }
    };
  }

  configure(yargs) {
    return yargs
      .positional('source', {
        describe: 'Origen en formato {conexion}.{tabla}',
        type: 'string'
      })
      .positional('destination', {
        describe: 'Destino en formato {conexion}.{tabla}',
        type: 'string'
      })
      .option('confirm', {
        describe: 'Confirmar la operación si la tabla destino tiene datos',
        type: 'boolean',
        default: false
      })
      .option('ignore-duplicates', {
        describe: 'Ignorar duplicados basados en la primary key',
        type: 'boolean',
        default: false
      })
      .option('limit', {
        describe: 'Número máximo de registros a copiar (para pruebas)',
        type: 'number'
      })
      .option('create_if_not_exists', {
        describe: 'Crear la tabla destino si no existe',
        type: 'boolean',
        default: false
      });
  }

  validate(argv) {
    const { source, destination } = argv;
    
    if (!source || !destination) {
      console.error('❌ Se requieren ambos argumentos: origen y destino');
      return false;
    }

    try {
      this.parseConnectionTable(source);
      this.parseConnectionTable(destination);
    } catch (error) {
      console.error(`❌ ${error.message}`);
      return false;
    }

    return true;
  }

  async execute(argv) {
    try {
      const { source, destination, confirm, 'ignore-duplicates': ignoreDuplicates, limit, 'create_if_not_exists': createIfNotExists } = argv;

      const { connection: sourceConnection, table: sourceTable } = this.parseConnectionTable(source);
      const { connection: destConnection, table: destTable } = this.parseConnectionTable(destination);

      // Get connections
      const sourceDb = await this.getConnection(sourceConnection);
      const destDb = await this.getConnection(destConnection);

      // Check if destination table has data
      let recordCount = 0;
      let tableExists = true;
      
      try {
        let countQuery;
        if (destDb.driver === 'pgsql') {
          const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[destConnection];
          const schema = dbConfig?.schema || 'public';
          countQuery = `SELECT COUNT(*) as count FROM "${schema}"."${destTable}"`;
        } else {
          countQuery = `SELECT COUNT(*) as count FROM \`${destTable}\``;
        }
        const countResult = await destDb.query(countQuery);
        recordCount = countResult[0]?.count || countResult[0]?.['count'] || 0;
      } catch (error) {
        // If the table doesn't exist, set tableExists to false
        if (error.message.includes('does not exist') || error.message.includes('no such table') || error.message.includes('doesn\'t exist')) {
          tableExists = false;
        } else {
          throw error; // Re-throw if it's a different error
        }
      }

      if (tableExists && recordCount > 0 && !confirm) {
        console.log(`⚠️  La tabla destino '${destConnection}.${destTable}' tiene ${recordCount} registros.`);
        console.log(`💡 Para continuar con la copia, use la opción --confirm`);
        await sourceDb.close();
        await destDb.close();
        process.exit(1);
      }
      
      // If the destination table doesn't exist and create_if_not_exists is true, create it
      if (!tableExists && createIfNotExists) {
        console.log(`🔧 Creando tabla destino '${destConnection}.${destTable}'...`);
        await this.createTableStructure(sourceDb, destDb, sourceTable, destTable);
        tableExists = true;
        recordCount = 0; // Fresh table has no records
      } else if (!tableExists) {
        console.log(`⚠️  La tabla destino '${destConnection}.${destTable}' no existe.`);
        console.log(`💡 Asegúrese de que la tabla destino exista antes de copiar datos.`);
        console.log(`💡 O use la opción --create_if_not_exists para crearla automáticamente.`);
        await sourceDb.close();
        await destDb.close();
        process.exit(1);
      }

      // Get table structure from source
      let sourceColumnsTemp = await this.getTableColumns(sourceDb, sourceTable, sourceConnection);
      
      // Filter out any potential metadata columns that shouldn't be part of the table structure
      // Common metadata columns that might be added by adapters
      const metadataColumns = ['database_name', '_database', 'datasource', '_source'];
      sourceColumnsTemp = sourceColumnsTemp.filter(col => !metadataColumns.includes(col.toLowerCase()));

      // Make sure we have the correct source columns for the rest of the process
      const sourceColumns = sourceColumnsTemp;

      // Prepare insert statement based on destination database type and ignore duplicates flag
      let insertQuery;
      const insertParams = [];

      if (destDb.driver === 'mysql') {
        if (ignoreDuplicates) {
          insertQuery = `INSERT IGNORE INTO \`${destTable}\` (${sourceColumns.map(col => `\`${col}\``).join(', ')}) VALUES `;
        } else {
          insertQuery = `INSERT INTO \`${destTable}\` (${sourceColumns.map(col => `\`${col}\``).join(', ')}) VALUES `;
        }
      } else if (destDb.driver === 'pgsql') {
        const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[destConnection];
        const schema = dbConfig?.schema || 'public';

        if (ignoreDuplicates) {
          insertQuery = `INSERT INTO "${schema}"."${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES `;
          // Add ON CONFLICT clause to handle duplicates
          // For now, we'll use the first column as a potential primary key
          // In a more sophisticated implementation, we'd determine the actual primary key
          const primaryKey = await this.getPrimaryKeyColumn(sourceDb, sourceTable);
          if (primaryKey) {
            insertQuery += ` ON CONFLICT ("${primaryKey}") DO NOTHING`;
          } else {
            // If no primary key is found, use the first column as a fallback
            insertQuery += ` ON CONFLICT ("${sourceColumns[0]}") DO NOTHING`;
          }
        } else {
          insertQuery = `INSERT INTO "${schema}"."${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES `;
        }
      } else { // SQLite
        if (ignoreDuplicates) {
          insertQuery = `INSERT OR IGNORE INTO "${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES `;
        } else {
          insertQuery = `INSERT INTO "${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES `;
        }
      }

      // Get records from source table with optional limit
      let selectQuery;
      if (sourceDb.driver === 'pgsql') {
        const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[sourceConnection];
        const schema = dbConfig?.schema || 'public';
        selectQuery = `SELECT ${sourceColumns.map(col => `"${col}"`).join(', ')} FROM "${schema}"."${sourceTable}"`;
        if (limit) {
          selectQuery += ` LIMIT ${limit}`;
        }
      } else if (sourceDb.driver === 'mysql') {
        selectQuery = `SELECT ${sourceColumns.map(col => `\`${col}\``).join(', ')} FROM \`${sourceTable}\``;
        if (limit) {
          selectQuery += ` LIMIT ${limit}`;
        }
      } else { // SQLite
        selectQuery = `SELECT ${sourceColumns.map(col => `"${col}"`).join(', ')} FROM "${sourceTable}"`;
        if (limit) {
          selectQuery += ` LIMIT ${limit}`;
        }
      }
      const rawRecords = await sourceDb.query(selectQuery);
      
      // Filter records to only include actual table columns (to avoid metadata columns from adapters)
      const records = rawRecords.map(rawRecord => {
        const filteredRecord = {};
        for (const col of sourceColumns) {
          filteredRecord[col] = rawRecord[col];
        }
        return filteredRecord;
      });

      if (records.length === 0) {
        console.log(`ℹ️  La tabla origen '${sourceConnection}.${sourceTable}' está vacía. No hay registros para copiar.`);
        await sourceDb.close();
        await destDb.close();
        return;
      }

      console.log(`📦 Copiando ${records.length} registros de '${sourceConnection}.${sourceTable}' a '${destConnection}.${destTable}'...`);

      // Process records in batches to avoid memory issues
      const batchSize = 1000;
      let totalInserted = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        if (destDb.driver === 'mysql') {
          if (ignoreDuplicates) {
            // For MySQL with ignoreDuplicates, use INSERT IGNORE
            const valueSets = [];
            const allParams = [];
            
            for (const record of batch) {
              const values = sourceColumns.map(col => {
                // Ensure we only use the actual column values from the record
                const value = record[col];
                // Handle JSON/JSONB values by converting to string representation
                if (value && typeof value === 'object') {
                  return JSON.stringify(value);
                }
                return value;
              });
              valueSets.push(`(${values.map(() => '?').join(', ')})`);
              allParams.push(...values);
            }
            
            const batchInsertQuery = insertQuery + valueSets.join(', ');
            const result = await destDb.query(batchInsertQuery, allParams);
            totalInserted += result.affectedRows || 0;
          } else {
            // For MySQL without ignoreDuplicates, we need to build multiple value sets
            const valueSets = [];
            const allParams = [];
            
            for (const record of batch) {
              const values = sourceColumns.map(col => {
                // Ensure we only use the actual column values from the record
                const value = record[col];
                // Handle JSON/JSONB values by converting to string representation
                if (value && typeof value === 'object') {
                  return JSON.stringify(value);
                }
                return value;
              });
              valueSets.push(`(${values.map(() => '?').join(', ')})`);
              allParams.push(...values);
            }
            
            const batchInsertQuery = insertQuery + valueSets.join(', ');
            const result = await destDb.query(batchInsertQuery, allParams);
            totalInserted += result.affectedRows || 0;
          }
        } else if (destDb.driver === 'pgsql') {
          // For PostgreSQL, handle each record separately due to parameterized queries
          // Also need to handle JSON/JSONB data types properly
          for (const record of batch) {
            const values = sourceColumns.map(col => {
              // Ensure we only use the actual column values from the record
              const value = record[col];
              // Handle JSON/JSONB values by converting to string representation
              if (value && typeof value === 'object') {
                return JSON.stringify(value);
              }
              return value;
            });
            const valueSet = `(${values.map((_, idx) => `$${idx + 1}`).join(', ')})`;
            const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[destConnection];
            const schema = dbConfig?.schema || 'public';
            
            let batchInsertQuery;
            if (ignoreDuplicates) {
              // For PostgreSQL with ignoreDuplicates, we need to determine the primary key
              const primaryKey = await this.getPrimaryKeyColumn(sourceDb, sourceTable);
              const conflictClause = primaryKey ? ` ON CONFLICT ("${primaryKey}") DO NOTHING` : ` ON CONFLICT ("${sourceColumns[0]}") DO NOTHING`;
              batchInsertQuery = `INSERT INTO "${schema}"."${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES ${valueSet}${conflictClause}`;
            } else {
              batchInsertQuery = `INSERT INTO "${schema}"."${destTable}" (${sourceColumns.map(col => `"${col}"`).join(', ')}) VALUES ${valueSet}`;
            }
            
            const result = await destDb.query(batchInsertQuery, values);
            totalInserted += result.rowCount || 0;
          }
        } else { // SQLite
          // For SQLite, handle batching
          if (ignoreDuplicates) {
            // For SQLite with ignoreDuplicates, use INSERT OR IGNORE
            for (const record of batch) {
              const values = sourceColumns.map(col => {
                // Ensure we only use the actual column values from the record
                const value = record[col];
                // Handle JSON/JSONB values by converting to string representation
                if (value && typeof value === 'object') {
                  return JSON.stringify(value);
                }
                return value;
              });
              const valueSet = `(${values.map(() => '?').join(', ')})`;
              const batchInsertQuery = insertQuery + valueSet;
              const result = await destDb.query(batchInsertQuery, values);
              totalInserted += result.changes || 0;
            }
          } else {
            // For SQLite without ignoreDuplicates
            for (const record of batch) {
              const values = sourceColumns.map(col => {
                // Ensure we only use the actual column values from the record
                const value = record[col];
                // Handle JSON/JSONB values by converting to string representation
                if (value && typeof value === 'object') {
                  return JSON.stringify(value);
                }
                return value;
              });
              const valueSet = `(${values.map(() => '?').join(', ')})`;
              const batchInsertQuery = insertQuery + valueSet;
              const result = await destDb.query(batchInsertQuery, values);
              totalInserted += result.changes || 0;
            }
          }
        }
      }

      console.log(`✅ Copia completada. ${totalInserted} registros insertados.`);

      await sourceDb.close();
      await destDb.close();
    } catch (error) {
      this.log(`Error ejecutando el comando copy: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Get table columns from the source database
   */
  async getTableColumns(db, table, connection) {
    if (db.driver === 'mysql') {
      const query = `SHOW COLUMNS FROM \`${table}\``;
      const result = await db.query(query);
      return result.map(row => row.Field);
    } else if (db.driver === 'pgsql') {
      const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connection];
      const schema = dbConfig?.schema || 'public';
      const query = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = '${schema}' AND table_name = '${table}'
        ORDER BY ordinal_position
      `;
      const result = await db.query(query);
      return result.map(row => row.column_name);
    } else { // SQLite
      const query = `PRAGMA table_info("${table}")`;
      const result = await db.query(query);
      return result.map(row => row.name);
    }
  }

  /**
   * Get primary key column name from the source database
   */
  async getPrimaryKeyColumn(db, table) {
    if (db.driver === 'mysql') {
      const query = `
        SELECT k.COLUMN_NAME
        FROM information_schema.TABLE_CONSTRAINTS AS t
        JOIN information_schema.KEY_COLUMN_USAGE AS k
        ON t.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY' AND t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = ?
      `;
      const result = await db.query(query, [table]);
      return result.length > 0 ? result[0].COLUMN_NAME : null;
    } else if (db.driver === 'pgsql') {
      const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[db.connectionName];
      const schema = dbConfig?.schema || 'public';
      const query = `
        SELECT a.attname
        FROM pg_class t,
             pg_class i,
             pg_index ix,
             pg_attribute a
        WHERE t.oid = ix.indrelid
          AND i.oid = ix.indexrelid
          AND a.attrelid = t.oid
          AND a.attnum = ANY(ix.indkey)
          AND t.relkind = 'r'
          AND t.relname = $1
          AND ix.indisprimary
      `;
      const result = await db.query(query, [table]);
      return result.length > 0 ? result[0].attname : null;
    } else { // SQLite
      const query = `PRAGMA table_info("${table}")`;
      const result = await db.query(query);
      const pkColumn = result.find(col => col.pk === 1);
      return pkColumn ? pkColumn.name : null;
    }
  }

  /**
   * Create destination table structure based on source table
   */
  async createTableStructure(sourceDb, destDb, sourceTable, destTable) {
    // Get table structure from source
    const tableInfo = await this.getTableInfo(sourceDb, sourceTable, destDb.driver);

    let createQuery = '';

    if (destDb.driver === 'mysql') {
      createQuery = `CREATE TABLE \`${destTable}\` (\n  ${tableInfo.columns.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    } else if (destDb.driver === 'pgsql') {
      const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[destDb.connectionName];
      const schema = dbConfig?.schema || 'public';
      createQuery = `CREATE TABLE "${schema}"."${destTable}" (\n  ${tableInfo.columns.join(',\n  ')}\n)`;
    } else { // SQLite
      createQuery = `CREATE TABLE "${destTable}" (\n  ${tableInfo.columns.join(',\n  ')}\n)`;
    }

    await destDb.query(createQuery);
    console.log(`✅ Tabla '${destTable}' creada exitosamente en la conexión '${destDb.connectionName}'.`);
  }

  /**
   * Get table structure information for different database types
   */
  async getTableInfo(db, table, destDriver) {
    let columns = [];
    
    if (db.driver === 'mysql') {
      const query = `DESCRIBE \`${table}\``;
      const result = await db.query(query);
      
      for (const row of result) {
        let columnDef = `"${row.Field}"`;
        
        // Convert MySQL types to appropriate types for destination
        if (destDriver === 'mysql') {
          columnDef = `\`${row.Field}\` ${row.Type}`;
          if (row.Null === 'NO') columnDef += ' NOT NULL';
          if (row.Extra.includes('auto_increment')) columnDef += ' AUTO_INCREMENT';
          if (row.Default !== null && row.Default !== undefined) {
            if (row.Default === '') {
              columnDef += " DEFAULT ''";
            } else {
              columnDef += ` DEFAULT ${typeof row.Default === 'string' ? `'${row.Default}'` : row.Default}`;
            }
          }
        } else if (destDriver === 'pgsql') {
          // Map MySQL types to PostgreSQL types
          let pgType = row.Type.toLowerCase();
          
          // Handle MySQL enum types - convert to TEXT to avoid PostgreSQL enum issues
          if (pgType.startsWith('enum(')) {
            pgType = 'TEXT';
          } else if (pgType.includes('int') && pgType.includes('unsigned')) {
            pgType = 'INTEGER';
          } else if (pgType.includes('bigint')) {
            pgType = 'BIGINT';
          } else if (pgType.includes('varchar')) {
            const match = pgType.match(/varchar\((\d+)\)/);
            if (match) pgType = `VARCHAR(${match[1]})`;
          } else if (pgType.includes('text')) {
            pgType = 'TEXT';
          } else if (pgType.includes('tinyint(1)')) {
            pgType = 'BOOLEAN';
          } else if (pgType.includes('timestamp') || pgType.includes('datetime')) {
            pgType = 'TIMESTAMP';
          } else if (pgType.includes('double')) {
            pgType = 'DOUBLE PRECISION';
          } else if (pgType.includes('float')) {
            pgType = 'REAL';
          } else if (pgType.includes('json')) {
            pgType = 'JSON';
          }

          columnDef = `"${row.Field}" ${pgType.toUpperCase()}`;
          if (row.Null === 'NO') columnDef += ' NOT NULL';
          if (row.Default !== null && row.Default !== undefined) {
            if (row.Default === 'NULL') {
              // Don't add DEFAULT NULL in PostgreSQL
            } else if (row.Default === '') {
              columnDef += " DEFAULT ''";
            } else if (row.Default === 'CURRENT_TIMESTAMP') {
              columnDef += ` DEFAULT ${row.Default}`;
            } else {
              columnDef += ` DEFAULT ${typeof row.Default === 'string' ? `'${row.Default}'` : row.Default}`;
            }
          }
        } else { // SQLite
          // Map MySQL types to SQLite types
          let sqliteType = row.Type.toLowerCase();
          if (sqliteType.includes('int')) {
            sqliteType = 'INTEGER';
          } else if (sqliteType.includes('varchar') || sqliteType.includes('text')) {
            sqliteType = 'TEXT';
          } else if (sqliteType.includes('bool')) {
            sqliteType = 'INTEGER'; // SQLite doesn't have a boolean type
          } else if (sqliteType.includes('timestamp') || sqliteType.includes('datetime')) {
            sqliteType = 'TEXT'; // Store as text in SQLite
          } else if (sqliteType.includes('double') || sqliteType.includes('float')) {
            sqliteType = 'REAL';
          } else if (sqliteType.includes('json')) {
            sqliteType = 'TEXT';
          }
          
          columnDef = `"${row.Field}" ${sqliteType.toUpperCase()}`;
          if (row.Null === 'NO') columnDef += ' NOT NULL';
          if (row.Default !== null && row.Default !== undefined) {
            if (row.Default === '') {
              columnDef += " DEFAULT ''";
            } else {
              columnDef += ` DEFAULT ${typeof row.Default === 'string' ? `'${row.Default}'` : row.Default}`;
            }
          }
        }
        
        columns.push(columnDef);
      }
    } else if (db.driver === 'pgsql') {
      const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[db.connectionName];
      const schema = dbConfig?.schema || 'public';
      const query = `
        SELECT
          c.column_name,
          CASE 
            WHEN c.data_type = 'USER-DEFINED' THEN 'USER-DEFINED'
            ELSE c.data_type
          END AS data_type,
          CASE 
            WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
            ELSE NULL
          END AS udt_name,
          c.is_nullable,
          c.column_default,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale
        FROM information_schema.columns c
        WHERE c.table_schema = '${schema}' AND c.table_name = '${table}'
        ORDER BY c.ordinal_position
      `;
      const result = await db.query(query);

      for (const row of result) {
        let columnDef = `"${row.column_name}"`;

        if (destDriver === 'pgsql') {
          let columnType;
          
          // Handle PostgreSQL types, including enums and other custom types
          // If data_type is USER-DEFINED, it's definitely a custom type like an enum
          if (row.data_type === 'USER-DEFINED') {
            // For enum types and other user-defined types, map them to TEXT to avoid needing to create the type first
            columnType = 'TEXT';
          } else if (row.data_type.toLowerCase().includes('enum')) {
            // Additional check for any other enum-like types
            columnType = 'TEXT';
          } else {
            columnType = row.data_type;
          }
          
          columnDef = `"${row.column_name}" ${columnType}`;
          
          if (row.character_maximum_length) {
            if (columnType === 'character varying' || columnType === 'varchar') {
              columnDef = `"${row.column_name}" VARCHAR(${row.character_maximum_length})`;
            }
          }
          if (row.is_nullable === 'NO') columnDef += ' NOT NULL';
          if (row.column_default) {
            // Handle default values that might reference enum types
            let defaultValue = row.column_default;
            
            // If the column was converted from an enum type to TEXT, 
            // we need to remove any enum type casting from the default value
            if (columnType === 'TEXT' && row.data_type === 'USER-DEFINED') {
              // Remove any type casting like ::my_enum_type
              defaultValue = defaultValue.replace(/::[\w"]+/g, '');
            }
            
            columnDef += ` DEFAULT ${defaultValue}`;
          }
        } else if (destDriver === 'mysql') {
          // Map PostgreSQL types to MySQL types
          let mysqlType = row.data_type;
          if (mysqlType === 'character varying' || mysqlType === 'varchar') {
            mysqlType = row.character_maximum_length ? 
              `VARCHAR(${row.character_maximum_length})` : 'VARCHAR(255)';
          } else if (mysqlType === 'timestamp without time zone') {
            mysqlType = 'TIMESTAMP';
          } else if (mysqlType === 'timestamp with time zone') {
            mysqlType = 'TIMESTAMP';
          } else if (mysqlType === 'boolean') {
            mysqlType = 'TINYINT(1)';
          } else if (mysqlType === 'integer') {
            mysqlType = 'INT';
          } else if (mysqlType === 'bigint') {
            mysqlType = 'BIGINT';
          } else if (mysqlType === 'smallint') {
            mysqlType = 'SMALLINT';
          } else if (mysqlType === 'numeric' || mysqlType === 'decimal') {
            mysqlType = row.numeric_precision ? 
              `DECIMAL(${row.numeric_precision}, ${row.numeric_scale})` : 'DECIMAL(10,2)';
          } else if (mysqlType === 'double precision') {
            mysqlType = 'DOUBLE';
          } else if (mysqlType === 'real') {
            mysqlType = 'FLOAT';
          } else if (mysqlType === 'json' || mysqlType === 'jsonb') {
            mysqlType = 'JSON';
          } else if (mysqlType === 'text') {
            mysqlType = 'TEXT';
          }
          
          columnDef = `\`${row.column_name}\` ${mysqlType}`;
          if (row.is_nullable === 'NO') columnDef += ' NOT NULL';
          if (row.column_default) {
            columnDef += ` DEFAULT ${row.column_default}`;
          }
        } else { // SQLite
          // Map PostgreSQL types to SQLite types
          let sqliteType = 'TEXT'; // Default to TEXT
          if (row.data_type.includes('int')) {
            sqliteType = 'INTEGER';
          } else if (row.data_type === 'boolean') {
            sqliteType = 'INTEGER'; // SQLite doesn't have a boolean type
          } else if (row.data_type.includes('timestamp') || row.data_type.includes('date') || row.data_type.includes('time')) {
            sqliteType = 'TEXT'; // Store as text in SQLite
          } else if (row.data_type === 'double precision' || row.data_type === 'real' || 
                     row.data_type === 'numeric' || row.data_type === 'decimal') {
            sqliteType = 'REAL';
          } else if (row.data_type === 'json' || row.data_type === 'jsonb') {
            sqliteType = 'TEXT';
          }
          
          columnDef = `"${row.column_name}" ${sqliteType}`;
          if (row.is_nullable === 'NO') columnDef += ' NOT NULL';
          if (row.column_default) {
            columnDef += ` DEFAULT ${row.column_default}`;
          }
        }
        
        columns.push(columnDef);
      }
    } else { // SQLite
      const query = `PRAGMA table_info("${table}")`;
      const result = await db.query(query);
      
      for (const row of result) {
        let columnDef = `"${row.name}"`;
        
        if (destDriver === 'sqlite') {
          columnDef = `"${row.name}" ${row.type}`;
          if (row.notnull === 1) columnDef += ' NOT NULL';
          if (row.dflt_value !== null) {
            columnDef += ` DEFAULT ${row.dflt_value}`;
          }
          if (row.pk === 1) columnDef += ' PRIMARY KEY';
        } else if (destDriver === 'mysql') {
          // Map SQLite types to MySQL types
          let mysqlType = row.type.toLowerCase();
          if (mysqlType.includes('int')) {
            mysqlType = 'INT';
          } else if (mysqlType.includes('varchar') || mysqlType.includes('text')) {
            mysqlType = 'VARCHAR(255)';
          } else if (mysqlType.includes('bool')) {
            mysqlType = 'TINYINT(1)';
          } else if (mysqlType.includes('timestamp') || mysqlType.includes('datetime')) {
            mysqlType = 'TIMESTAMP';
          } else if (mysqlType.includes('double') || mysqlType.includes('real') || 
                     mysqlType.includes('float')) {
            mysqlType = 'DOUBLE';
          } else if (mysqlType.includes('json')) {
            mysqlType = 'JSON';
          }
          
          columnDef = `\`${row.name}\` ${mysqlType}`;
          if (row.notnull === 1) columnDef += ' NOT NULL';
          if (row.dflt_value !== null) {
            columnDef += ` DEFAULT ${row.dflt_value}`;
          }
        } else { // PostgreSQL
          // Map SQLite types to PostgreSQL types
          let pgType = 'TEXT'; // Default to TEXT
          if (row.type.toLowerCase().includes('int')) {
            pgType = 'INTEGER';
          } else if (row.type.toLowerCase().includes('varchar') || row.type.toLowerCase().includes('text')) {
            pgType = 'TEXT';
          } else if (row.type.toLowerCase().includes('bool')) {
            pgType = 'BOOLEAN';
          } else if (row.type.toLowerCase().includes('timestamp') || row.type.toLowerCase().includes('datetime')) {
            pgType = 'TIMESTAMP';
          } else if (row.type.toLowerCase().includes('double') || row.type.toLowerCase().includes('real') || 
                     row.type.toLowerCase().includes('float')) {
            pgType = 'DOUBLE PRECISION';
          } else if (row.type.toLowerCase().includes('json')) {
            pgType = 'JSON';
          }
          
          columnDef = `"${row.name}" ${pgType}`;
          if (row.notnull === 1) columnDef += ' NOT NULL';
          if (row.dflt_value !== null) {
            columnDef += ` DEFAULT ${row.dflt_value}`;
          }
        }
        
        columns.push(columnDef);
      }
    }
    
    return { columns };
  }
}