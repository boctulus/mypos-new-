import { SqlBaseCommand } from './SqlBaseCommand.js';

export class QueryCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'query';
    this.description = 'Execute a general SQL query';
    this.examples = [
      'node com sql query "SELECT COUNT(*) FROM categories" --connection=zippy',
      'node com sql query "SELECT * FROM products WHERE price > 100" --connection=main'
    ];
  }

  static get config() {
    return {
      positional: ['query'],
      optionalArgs: ['connection', 'format'],
      validation: {},
      options: {
        query: {
          describe: 'SQL query to execute',
          type: 'string'
        },
        connection: {
          describe: 'Database connection name',
          type: 'string',
          default: 'main'
        },
        format: {
          describe: 'Output format (table, json, csv)',
          type: 'string',
          default: 'table',
          choices: ['table', 'json', 'csv']
        }
      }
    };
  }

  async execute(argv) {
    try {
      // Get query from either positional argument or named argument
      const query = argv.query || (argv._ && argv._[0]);
      if (!query) {
        throw new Error('Query is required. Usage: node com sql query "SELECT ..." --connection=name');
      }

      const db = await this.getConnection(argv.connection);

      const results = await db.query(query);

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
    } catch (error) {
      this.log(`Error executing query command: ${error.message}`, 'error');
      throw error;
    }
  }
}