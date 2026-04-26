import { SqlBaseCommand } from './SqlBaseCommand.js';

export class CountCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'count';
    this.description = 'Count records in a table';
    this.examples = [
      'node com sql count \'main.users\'',
      'node com sql count \'zippy.categories\''
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
        query = `SELECT COUNT(*) as total FROM "${schema}"."${table}"`;
      } else if (db.driver === 'mysql') {
        query = `SELECT COUNT(*) as total FROM ??`;
        params = [table];
      } else {
        query = `SELECT COUNT(*) as total FROM "${table}"`;
      }

      const results = await db.query(query, params);

      // Extract the count value depending on the database driver
      let count;
      if (results.length > 0) {
        if (db.driver === 'pgsql') {
          count = results[0].total;
        } else {
          count = results[0]['COUNT(*)'] || results[0].total;
        }
      } else {
        count = 0;
      }

      console.log(count);

      await db.close();
    } catch (error) {
      this.log(`Error executing count command: ${error.message}`, 'error');
      throw error;
    }
  }
}