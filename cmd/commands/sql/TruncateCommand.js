import { SqlBaseCommand } from './SqlBaseCommand.js';

export class TruncateCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'truncate';
    this.description = 'Truncate a table (remove all records)';
    this.examples = [
      'node com sql truncate main.customers',
      'node com sql truncate zippy.categories'
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
      let params = [];

      if (db.driver === 'pgsql') {
        const dbConfig = (await import('../../config/databases.config.js')).default.db_connections[connection];
        const schema = dbConfig?.schema || 'public';
        query = `TRUNCATE TABLE "${schema}"."${table}" RESTART IDENTITY CASCADE`;
      } else if (db.driver === 'mysql') {
        query = `TRUNCATE TABLE ??`;
        params = [table];
      } else {
        query = `DELETE FROM "${table}"`;
      }

      await db.query(query, params);

      console.log(`✓ Table '${connection}.${table}' truncated successfully`);

      await db.close();
    } catch (error) {
      this.log(`Error executing truncate command: ${error.message}`, 'error');
      throw error;
    }
  }
}
