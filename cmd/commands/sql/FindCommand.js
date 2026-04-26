import { SqlBaseCommand } from './SqlBaseCommand.js';

export class FindCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'find';
    this.description = 'Find a record by ID (primary key or id field)';
    this.examples = [
      'node com sql find users 1 --connection=main',
      'node com sql find products abc123 --connection=main'
    ];
  }

  static get config() {
    return {
      positional: ['table', 'id'],
      optionalArgs: ['connection', 'format', 'id-field'],
      validation: {},
      options: {
        table: {
          describe: 'Table name to query',
          type: 'string'
        },
        id: {
          describe: 'ID value to search for',
          type: 'string'
        },
        connection: {
          describe: 'Database connection name',
          type: 'string',
          default: 'main'
        },
        'id-field': {
          describe: 'Field name to use as ID (default: id or primary key)',
          type: 'string',
          default: 'id'
        },
        format: {
          describe: 'Output format (table, json, csv, line)',
          type: 'string',
          default: 'json',  // Changed default to 'json'
          choices: ['table', 'json', 'csv', 'line']
        }
      }
    };
  }

  configure(yargs) {
    return yargs
      .positional('table', {
        describe: 'Table name to query',
        type: 'string',
        demandOption: true
      })
      .positional('id', {
        describe: 'ID value to search for',
        type: 'string',
        demandOption: true
      })
      .option('connection', {
        describe: 'Database connection name',
        type: 'string',
        default: 'main'
      })
      .option('id-field', {
        describe: 'Field name to use as ID (default: id or primary key)',
        type: 'string',
        default: 'id'
      })
      .option('format', {
        describe: 'Output format (table, json, csv)',
        type: 'string',
        default: 'table',
        choices: ['table', 'json', 'csv']
      });
  }

  async execute(argv) {
    try {
      const { table, id, connection, idField, format } = argv;

      if (!table) {
        throw new Error('Table name is required');
      }

      if (!id) {
        throw new Error('ID value is required');
      }

      // Apply default format if not specified
      const effectiveFormat = format || 'json';

      const db = await this.getConnection(connection);

      // Determine the ID field to use
      let actualIdField = idField;

      // Try to determine the primary key if idField is 'id' (default)
      if (idField === 'id') {
        actualIdField = await this.getPrimaryKey(db, table);
        if (!actualIdField) {
          actualIdField = 'id'; // fallback to 'id' if no primary key found
        }
      }

      // Ensure actualIdField is not undefined
      if (!actualIdField) {
        actualIdField = 'id'; // fallback to 'id' if determination failed
      }

      // Build the query based on the database driver
      let query;
      if (db.driver === 'pgsql') {
        const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connection];
        const schema = dbConfig?.schema || 'public';
        query = `SELECT * FROM "${schema}"."${table}" WHERE "${actualIdField}" = $1`;
      } else {
        query = `SELECT * FROM ${table} WHERE ${actualIdField} = ?`;
      }

      // Execute the query
      const results = await db.query(query, [id]);

      // Format output based on --format option
      switch (effectiveFormat) {
        case 'json':
          this.formatAsJson(results);
          break;
        case 'csv':
          this.formatAsCsv(results);
          break;
        case 'line':
          this.formatAsLines(results);
          break;
        case 'table':
          this.formatAsTable(results);
          break;
        default:
          // This shouldn't happen if our choices are enforced properly, but just in case
          this.formatAsJson(results);
          break;
      }

      await db.close();
    } catch (error) {
      this.log(`Error executing find command: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Get the primary key column name for a table
   */
  async getPrimaryKey(db, table) {
    try {
      switch (db.driver) {
        case 'mysql':
          // Query to get primary key column for MySQL
          const mysqlResult = await db.query(`
            SELECT COLUMN_NAME 
            FROM information_schema.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ?
            AND CONSTRAINT_NAME = 'PRIMARY'
            ORDER BY ORDINAL_POSITION
          `, [table]);

          return mysqlResult.length > 0 ? mysqlResult[0].COLUMN_NAME : null;

        case 'pgsql':
          // Query to get primary key column for PostgreSQL
          const pgConfig = (await import('../../config/databases.config.js')).default.db_connections[db.connectionName || 'main'];
          const pgSchema = pgConfig?.schema || 'public';

          const pgResult = await db.query(`
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass
            AND i.indisprimary
          `, [`"${pgSchema}"."${table}"`]);

          return pgResult.length > 0 ? pgResult[0].attname : null;

        case 'sqlite':
          // Query to get primary key column for SQLite
          const sqliteResult = await db.query(`
            PRAGMA table_info(${table})
          `);

          const pkColumn = sqliteResult.find(col => col.pk === 1);
          return pkColumn ? pkColumn.name : null;

        default:
          return null;
      }
    } catch (error) {
      // If we can't determine the primary key, return null to fallback to 'id'
      return null;
    }
  }
}