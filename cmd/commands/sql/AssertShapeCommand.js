import { SqlBaseCommand } from './SqlBaseCommand.js';

export class AssertShapeCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'assert-shape';
    this.description = 'Assert that columns exist in a table';
    this.examples = [
      'node com sql assert-shape invoicing_settings api_keys',
      'node com sql assert-shape users id email name --connection=main'
    ];
  }

  static get config() {
    return {
      positional: ['table', 'columns...'],
      optionalArgs: ['connection'],
      validation: {},
      options: {
        table: {
          describe: 'Table name to check',
          type: 'string'
        },
        'columns...': {
          describe: 'Column names to assert existence',
          type: 'string',
          array: true
        },
        connection: {
          describe: 'Database connection name',
          type: 'string',
          default: 'main'
        }
      }
    };
  }

  configure(yargs) {
    return yargs
      .positional('table', {
        describe: 'Table name to check',
        type: 'string'
      })
      .positional('columns', {
        describe: 'Column names to assert existence',
        type: 'string',
        array: true
      })
      .option('connection', {
        describe: 'Database connection name',
        type: 'string',
        default: 'main'
      });
  }

  validate(argv) {
    const { table, columns } = argv;

    if (!table) {
      console.error('❌ Table name is required');
      return false;
    }

    if (!columns || columns.length === 0) {
      console.error('❌ At least one column is required');
      return false;
    }

    return true;
  }

  async execute(argv) {
    try {
      const table = argv.table;
      const columns = argv.columns || [];

      if (!Array.isArray(columns)) {
        columns = [columns];
      }

      const connectionName = argv.connection || 'main';
      
      // Get connection with silent mode for PostgreSQL to suppress error logging
      const db = await this.getConnection(connectionName, { silent: true });

      // Build query to check columns
      const quotedColumns = columns.map(col => {
        // Quote column names based on driver
        if (db.driver === 'pgsql') {
          return `"${col}"`;
        } else if (db.driver === 'mysql') {
          return `\`${col}\``;
        } else {
          return `"${col}"`; // sqlite
        }
      });

      const sql = `SELECT ${quotedColumns.join(', ')} FROM ${table} LIMIT 1`;

      try {
        await db.query(sql);
        console.log(`✅ Contract valid: All columns exist in table '${table}'`);
        console.log(`   Columns: ${columns.join(', ')}`);
      } catch (error) {
        console.error(`❌ Column does not exist or contract invalid`);
        console.error(`   Table: ${table}`);
        console.error(`   Columns checked: ${columns.join(', ')}`);
        console.error(`   Error: ${error.message}`);
        process.exit(1);
      }

      await db.close();
    } catch (error) {
      this.log(`Error executing assert-shape command: ${error.message}`, 'error');
      throw error;
    }
  }
}
