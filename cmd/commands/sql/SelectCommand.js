import { SqlBaseCommand } from './SqlBaseCommand.js';

export class SelectCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'select';
    this.description = 'Execute a SELECT query';
    this.examples = [
      'node com sql select "SELECT COUNT(*) as total FROM products" --connection=main',
      'node com sql select "SELECT * FROM users WHERE active = 1" --connection=main'
    ];
  }

  static get config() {
    return {
      positional: ['query'],
      optionalArgs: ['connection', 'format'],
      validation: {},
      options: {
        query: {
          describe: 'SELECT SQL query to execute',
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
        throw new Error('Query is required. Usage: node com sql select "SELECT ..." --connection=name');
      }

      // Validate that the query starts with SELECT
      const upperQuery = query.trim().toUpperCase();
      if (!upperQuery.startsWith('SELECT')) {
        throw new Error('Only SELECT queries are allowed with the select command. Use "statement" for other operations.');
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
      this.log(`Error executing select command: ${error.message}`, 'error');
      throw error;
    }
  }
}