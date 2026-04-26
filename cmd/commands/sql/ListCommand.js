import { SqlBaseCommand } from './SqlBaseCommand.js';

export class ListCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'list';
    this.description = 'List tables in a database or contents of a specific table';
    this.examples = [
      'node com sql list \'main\'',                           // List all tables in main database
      'node com sql list \'main\' --add_count',               // List all tables with record counts
      'node com sql list \'main.users\'',                     // List records from users table
      'node com sql list \'main.users\' --limit=20',          // List first 20 records
      'node com sql list \'main.users\' --offset=10 --limit=5', // List 5 records starting from offset 10
      'node com sql list \'main.users\' --format=table'       // Display results as ASCII table
    ];
  }

  static get config() {
    return {
      positional: ['target'],
      optionalArgs: ['offset', 'limit', 'format'],
      validation: {},
      options: {
        target: {
          describe: 'Connection and optional table in format {connection} or {connection}.{table}',
          type: 'string'
        },
        offset: {
          describe: 'Offset for pagination',
          type: 'number',
          default: 0
        },
        limit: {
          describe: 'Limit number of records',
          type: 'number',
          default: 10
        },
        format: {
          describe: 'Output format (table, json, csv)',
          type: 'string',
          default: 'table',
          choices: ['table', 'json', 'csv']
        },
        add_count: {
          describe: 'Add record count column when listing tables',
          type: 'boolean',
          default: false
        }
      }
    };
  }

  async execute(argv) {
    try {
      const target = argv.target || (argv._ && argv._[0]);
      if (!target) {
        throw new Error('Target must be specified in format {connection} or {connection}.{table}');
      }

      // Check if target contains a dot (indicating connection.table format) or just connection
      if (target.includes('.')) {
        // Format is connection.table - list records from the table
        const { connection, table } = this.parseConnectionTable(target);
        await this.listTableRecords(connection, table, argv);
      } else {
        // Format is just connection - list all tables in the database
        const cleanConnection = target.replace(/^['"]|['"]$/g, '');
        await this.listTables(cleanConnection, argv);
      }
    } catch (error) {
      this.log(`Error executing list command: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * List records from a specific table
   */
  async listTableRecords(connection, table, argv) {
    const db = await this.getConnection(connection);

    // Build query with offset and limit
    let query;
    let params;

    if (db.driver === 'pgsql') {
      // For PostgreSQL, get the schema from config and use schema-qualified table name
      const connections = (await import('../../config/databases.config.js')).default.db_connections;
      const schema = connections[connection]?.schema || 'public';

      // Use schema-qualified table name with proper quoting
      query = `SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`;
      params = [argv.limit, argv.offset];
    } else if (db.driver === 'mysql') {
      // For MySQL, use identifier placeholders
      query = `SELECT * FROM ?? LIMIT ? OFFSET ?`;
      params = [table, argv.limit, argv.offset];
    } else {
      // For SQLite
      query = `SELECT * FROM "${table}" LIMIT ? OFFSET ?`;
      params = [argv.limit, argv.offset];
    }

    const results = await db.query(query, params);

    // Format output based on --format option
    switch (argv.format) {
      case 'json':
        this.formatAsJson(results);
        break;
      case 'csv':
        this.formatAsCsv(results);
        break;
      case 'table':
      default:
        this.formatAsTable(results);
        break;
    }

    await db.close();
  }

  /**
   * List all tables in the database
   */
  async listTables(connectionName, argv) {
    const db = await this.getConnection(connectionName);

    let query;

    if (db.driver === 'pgsql') {
      const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connectionName];
      const schema = dbConfig?.schema || 'public';
      query = `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = '${schema}' UNION SELECT viewname AS table_name FROM pg_views WHERE schemaname = '${schema}'`;
    } else if (db.driver === 'mysql') {
      query = `SHOW TABLES`;
    } else {
      query = `SELECT name AS table_name FROM sqlite_master WHERE type='table'`;
    }

    const results = await db.query(query);

    // If add_count flag is provided, get record counts for each table
    let processedResults = results;
    if (argv.add_count) {
      processedResults = await this.addRecordCounts(results, db, connectionName);
    }

    // Format output based on --format option
    switch (argv.format) {
      case 'json':
        this.formatAsJson(processedResults);
        break;
      case 'csv':
        this.formatAsCsv(processedResults);
        break;
      case 'table':
      default:
        // For table listing, format differently
        if (processedResults.length > 0) {
          console.table(processedResults);
        } else {
          console.log('No tables found in the database.');
        }
        break;
    }

    await db.close();
  }

  /**
   * Add record counts to table list results
   */
  async addRecordCounts(results, db, connectionName) {
    const processedResults = [];

    // Get schema for PostgreSQL
    let schema = 'public';
    if (db.driver === 'pgsql') {
      const connections = (await import('../../config/databases.config.js')).default.db_connections;
      schema = connections[connectionName]?.schema || 'public';
    }

    for (const row of results) {
      let tableName;

      // Handle different database formats
      if (db.driver === 'mysql') {
        // MySQL returns results as { Tables_in_dbname: 'table_name' }
        tableName = Object.values(row)[0];
      } else {
        tableName = row.table_name;
      }

      // Build count query based on database type
      let countQuery;
      let countParams = [];

      if (db.driver === 'pgsql') {
        // Use schema-qualified table name for PostgreSQL
        countQuery = `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`;
      } else if (db.driver === 'mysql') {
        countQuery = `SELECT COUNT(*) as count FROM ??`;
        countParams = [tableName];
      } else {
        countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
      }

      try {
        const countResult = await db.query(countQuery, countParams);
        const count = countResult[0]?.count || 0;

        // Add count to the row object
        processedResults.push({
          table_name: tableName,
          count: parseInt(count)
        });
      } catch (error) {
        // If there's an error getting the count (e.g., table doesn't exist anymore),
        // still include the table name with count 0
        processedResults.push({
          table_name: tableName,
          count: 0
        });
      }
    }

    return processedResults;
  }
}