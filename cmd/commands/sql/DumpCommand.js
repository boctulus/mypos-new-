import { SqlBaseCommand } from './SqlBaseCommand.js';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execPromise = promisify(exec);

export class DumpCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'dump';
    this.description = 'Dump entire database to SQL file';
    this.examples = [
      'node com sql dump \'main\' --path=/tmp/main_backup.sql',
      'node com sql dump \'zippy\' --path=/backups/zippy_dump_2023.sql'
    ];
  }

  static get config() {
    return {
      positional: ['connection'],
      optionalArgs: ['path'],
      validation: {},
      options: {
        connection: {
          describe: 'Connection name to dump',
          type: 'string'
        },
        path: {
          describe: 'Path to save the dump file',
          type: 'string'
        }
      }
    };
  }

  async execute(argv) {
    try {
      const connectionName = argv.connection || (argv._ && argv._[0]);
      if (!connectionName) {
        throw new Error('Connection name must be specified');
      }

      const cleanConnection = connectionName.replace(/^['"]|['"]$/g, '');

      // Get database configuration
      const databasesConfig = (await import('../../config/databases.config.js')).default;
      const connections = databasesConfig.db_connections;

      if (!connections[cleanConnection]) {
        throw new Error(`Connection '${cleanConnection}' not found in databases.config.js`);
      }

      const config = connections[cleanConnection];

      // Determine output path
      let outputPath = argv.path;
      if (!outputPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputPath = `${cleanConnection}_backup_${timestamp}.sql`;
      }

      // Ensure directory exists
      const dirPath = path.dirname(outputPath);
      await fs.mkdir(dirPath, { recursive: true });

      console.log(`🚀 Starting database dump for connection: ${cleanConnection}`);
      console.log(`💾 Output path: ${outputPath}`);

      // Perform the dump based on database driver
      switch (config.driver) {
        case 'mysql':
          await this.dumpMysql(config, outputPath);
          break;
        case 'pgsql':
          await this.dumpPostgreSQL(config, cleanConnection, outputPath);
          break;
        case 'sqlite':
          await this.dumpSQLite(config, outputPath);
          break;
        default:
          throw new Error(`Unsupported database driver for dump: ${config.driver}`);
      }

      console.log(`✅ Database dump completed successfully: ${outputPath}`);
    } catch (error) {
      this.log(`Error executing dump command: ${error.message}`, 'error');
      console.log(`⚠️  Note: If you're experiencing version compatibility issues with database dump tools,`);
      console.log(`   consider using the export command instead: node com sql export '${argv.connection}' --path=/some/dir`);
      throw error;
    }
  }

  async dumpMysql(config, outputPath) {
    const { host, port, db_name, user, pass } = config;

    // Check if mysqldump is available
    try {
      await execPromise('mysqldump --version');
    } catch (error) {
      throw new Error('mysqldump utility not found. Please install MySQL client tools.');
    }

    const command = `mysqldump --host=${host} --port=${port} --user=${user} --password=${pass} --routines --triggers ${db_name} > "${outputPath}"`;

    try {
      await execPromise(command);
    } catch (error) {
      throw new Error(`Failed to dump MySQL database: ${error.message}`);
    }
  }

  async dumpPostgreSQL(config, connectionName, outputPath) {
    const { host, port, db_name, user, pass, schema } = config;

    // Check if pg_dump is available
    try {
      await execPromise('pg_dump --version');
    } catch (error) {
      throw new Error('pg_dump utility not found. Please install PostgreSQL client tools.');
    }

    // Try to use pg_dump with a version-compatible command
    const env = { ...process.env, PGPASSWORD: pass };

    // Build the command based on whether a specific schema is requested
    let command;
    if (schema && schema !== 'public') {
      command = `pg_dump --host=${host} --port=${port} --username=${user} --dbname=${db_name} --schema=${schema} --no-owner --no-privileges --no-password > "${outputPath}"`;
    } else {
      command = `pg_dump --host=${host} --port=${port} --username=${user} --dbname=${db_name} --no-owner --no-privileges --no-password > "${outputPath}"`;
    }

    try {
      await execPromise(command, { env });
    } catch (error) {
      // If pg_dump fails due to version mismatch, fall back to SQL queries approach
      console.warn('⚠️  pg_dump failed, falling back to SQL queries approach...');
      await this.dumpPostgreSQLWithQueries(connectionName, outputPath);
    }
  }

  async dumpPostgreSQLWithQueries(connectionName, outputPath) {
    const db = await this.getConnection(connectionName); // Using connection name as identifier

    // Get list of all tables in the database
    const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connectionName];
    const schema = dbConfig?.schema || 'public';
    const query = `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = '${schema}' UNION SELECT viewname AS table_name FROM pg_views WHERE schemaname = '${schema}'`;

    const results = await db.query(query);

    if (results.length === 0) {
      console.log(`⚠️ No tables found in connection '${connectionName}'`);
      await db.close();
      return;
    }

    console.log(`📊 Found ${results.length} tables to dump...`);

    // Initialize the SQL dump content
    let sqlDump = `-- Database dump for ${connectionName}\n`;
    sqlDump += `-- Generated on ${new Date().toISOString()}\n\n`;

    // Process each table
    for (const row of results) {
      let tableName = row.table_name;

      console.log(`📦 Dumping table: ${tableName}`);

      // Get table structure
      const tableDefQuery = `SELECT column_name, data_type, is_nullable, column_default
                             FROM information_schema.columns
                             WHERE table_schema = '${schema}' AND table_name = '${tableName}'
                             ORDER BY ordinal_position`;

      const tableDefResults = await db.query(tableDefQuery);

      // Build CREATE TABLE statement
      sqlDump += `-- Table: ${tableName}\n`;
      sqlDump += `CREATE TABLE IF NOT EXISTS "${tableName}" (\n`;

      const columns = [];
      for (const col of tableDefResults) {
        let colDef = `"${col.column_name}" ${col.data_type}`;
        if (col.is_nullable === 'NO') {
          colDef += ' NOT NULL';
        }
        if (col.column_default) {
          colDef += ` DEFAULT ${col.column_default}`;
        }
        columns.push(colDef);
      }

      sqlDump += `  ${columns.join(',\n  ')}\n`;
      sqlDump += `);\n\n`;

      // Get table data
      const dataQuery = `SELECT * FROM "${schema}"."${tableName}"`;
      const dataResults = await db.query(dataQuery);

      // Generate INSERT statements
      if (dataResults.length > 0) {
        const columns = Object.keys(dataResults[0]);
        sqlDump += `-- Data for table: ${tableName}\n`;

        for (const row of dataResults) {
          const values = columns.map(col => {
            let val = row[col];
            if (val === null) {
              return 'NULL';
            } else if (typeof val === 'string') {
              // Escape single quotes and wrap in quotes
              return `'${val.replace(/'/g, "''")}'`;
            } else if (typeof val === 'boolean') {
              return val ? 'TRUE' : 'FALSE';
            } else {
              return val;
            }
          }).join(', ');

          sqlDump += `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values});\n`;
        }

        sqlDump += `\n`;
      }
    }

    // Write the SQL dump to file
    await fs.writeFile(outputPath, sqlDump);

    await db.close();
  }

  async dumpSQLite(config, outputPath) {
    const { db_name } = config;

    // For SQLite, we can use the sqlite3 command-line tool
    try {
      await execPromise('sqlite3 -version');
    } catch (error) {
      throw new Error('sqlite3 utility not found. Please install SQLite client tools.');
    }

    // Use SQLite's built-in .dump command
    const command = `sqlite3 "${db_name}" ".dump" > "${outputPath}"`;

    try {
      await execPromise(command);
    } catch (error) {
      throw new Error(`Failed to dump SQLite database: ${error.message}`);
    }
  }
}