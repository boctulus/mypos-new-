import { SqlBaseCommand } from './SqlBaseCommand.js';

export class StatementCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'statement';
    this.description = 'Execute a non-SELECT SQL statement (INSERT, UPDATE, DELETE, etc.)';
    this.examples = [
      'node com sql statement "INSERT INTO users (name, email) VALUES (\'John\', \'john@example.com\')" --connection=main',
      'node com sql statement "DROP TABLE old_table" --connection=main --force',
      'node com sql statement "DELETE FROM users" --connection=main --confirm'
    ];
  }

  static get config() {
    return {
      positional: ['statement'],
      optionalArgs: ['connection', 'force', 'confirm'],
      validation: {},
      options: {
        statement: {
          describe: 'SQL statement to execute',
          type: 'string'
        },
        connection: {
          describe: 'Database connection name',
          type: 'string',
          default: 'main'
        },
        force: {
          describe: 'Force execution of potentially destructive operations',
          type: 'boolean',
          default: false
        },
        confirm: {
          describe: 'Confirm execution of potentially destructive operations (alternative to --force)',
          type: 'boolean',
          default: false
        }
      }
    };
  }

  async execute(argv) {
    try {
      // Get statement from either positional argument or named argument
      const statement = argv.statement || (argv._ && argv._[0]);
      if (!statement) {
        throw new Error('Statement is required. Usage: node com sql statement "SQL ..." --connection=name');
      }

      // Check if the statement is potentially destructive
      this.validateQuery(statement, argv.force || argv.confirm);

      const db = await this.getConnection(argv.connection);

      const results = await db.query(statement);

      // For non-SELECT statements, typically we just report success
      console.log('✅ Statement executed successfully');

      // If there are results (like from INSERT with RETURNING), show them
      if (results && results.length > 0) {
        console.log('Results:');
        this.formatAsTable(results);
      }

      await db.close();
    } catch (error) {
      this.log(`Error executing statement command: ${error.message}`, 'error');
      throw error;
    }
  }
}