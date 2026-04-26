import { SqlBaseCommand } from './SqlBaseCommand.js';

export class DescribeCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'describe';
    this.description = 'Show the structure of a table';
    this.examples = [
      'node com sql describe \'main.users\'',
      'node com sql describe \'zippy.products\''
    ];
  }

  static get config() {
    return {
      positional: ['connectionTable'],
      optionalArgs: [],
      validation: {},
      options: {
        connectionTable: {
          describe: 'Connection and table in format {connection}.{table}',
          type: 'string'
        }
      }
    };
  }

  async execute(argv) {
    try {
      const connectionTable = argv.connectionTable || (argv._ && argv._[0]);
      if (!connectionTable) {
        throw new Error('Connection and table must be specified in format {connection}.{table}');
      }

      const { connection, table } = this.parseConnectionTable(connectionTable);

      const db = await this.getConnection(connection);

      let query;
      let results;

      if (db.driver === 'pgsql') {
        // PostgreSQL: Get column information from information_schema
        const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connection];
        const schema = dbConfig?.schema || 'public';

        query = `
          SELECT 
            column_name AS "Field",
            data_type AS "Type", 
            is_nullable AS "Null", 
            column_default AS "Default"
          FROM information_schema.columns 
          WHERE table_name = $1 AND table_schema = $2
          ORDER BY ordinal_position
        `;
        results = await db.query(query, [table, schema]);
      } else if (db.driver === 'mysql') {
        // MySQL: Use DESCRIBE statement
        query = `DESCRIBE ??`;
        results = await db.query(query, [table]);
      } else {
        // SQLite: Use PRAGMA to get table info
        query = `PRAGMA table_info("${table}")`;
        results = await db.query(query);

        // Transform SQLite pragma results to match expected format
        results = results.map(col => ({
          Field: col.name,
          Type: col.type,
          Null: col.notnull ? 'NO' : 'YES',
          Default: col.dflt_value,
          Key: col.pk ? 'PRI' : '',
          Extra: ''
        }));
      }

      // Display the table structure
      console.table(results);

      await db.close();
    } catch (error) {
      this.log(`Error executing describe command: ${error.message}`, 'error');
      throw error;
    }
  }
}