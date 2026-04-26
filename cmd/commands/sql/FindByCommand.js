import { SqlBaseCommand } from './SqlBaseCommand.js';

export class FindByCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'find_by';
    this.description = 'Find records by field value (WHERE field = value)';
    this.examples = [
      'node com sql find_by users email:user@example.com --connection=main',
      'node com sql find_by products category:electronics --connection=main'
    ];
  }

  static get config() {
    return {
      positional: ['table', 'condition'],
      optionalArgs: ['connection', 'format'],
      validation: {},
      options: {
        table: {
          describe: 'Table name to query',
          type: 'string'
        },
        condition: {
          describe: 'Condition in format field:value',
          type: 'string'
        },
        connection: {
          describe: 'Database connection name',
          type: 'string',
          default: 'main'
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
      .positional('condition', {
        describe: 'Condition in format field:value',
        type: 'string',
        demandOption: true
      })
      .option('connection', {
        describe: 'Database connection name',
        type: 'string',
        default: 'main'
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
      const { table, condition, connection, format } = argv;

      if (!table) {
        throw new Error('Table name is required');
      }

      if (!condition) {
        throw new Error('Condition in format field:value is required');
      }

      // Apply default format if not specified
      const effectiveFormat = format || 'json';

      // Parse the condition field:value
      const separatorIndex = condition.indexOf(':');
      if (separatorIndex === -1) {
        throw new Error('Condition must be in format field:value');
      }

      const field = condition.substring(0, separatorIndex);
      const value = condition.substring(separatorIndex + 1);

      if (!field || !value) {
        throw new Error('Both field and value are required in field:value format');
      }

      const db = await this.getConnection(connection);

      // Build the query based on the database driver
      let query;
      if (db.driver === 'pgsql') {
        query = `SELECT * FROM ${table} WHERE ${field} = $1`;
      } else {
        query = `SELECT * FROM ${table} WHERE ${field} = ?`;
      }

      // Execute the query
      const results = await db.query(query, [value]);

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
      this.log(`Error executing find_by command: ${error.message}`, 'error');
      throw error;
    }
  }
}