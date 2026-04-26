import { SqlBaseCommand } from './SqlBaseCommand.js';
import fs from 'fs/promises';
import path from 'path';

export class ExportCommand extends SqlBaseCommand {
  constructor() {
    super();
    this.command = 'export';
    this.description = 'Export table data';
    this.examples = [
      'node com sql export \'zippy.categories\' --format=csv',
      'node com sql export \'zippy.products\' --format=json --path=/tmp/products.json',
      'node com sql export \'zippy.categories\' --format=csv --file=/tmp/categories.csv'
    ];
  }

  static get config() {
    return {
      positional: ['connectionTable'],
      optionalArgs: ['format', 'path', 'file'],
      validation: {
        format: {
          choices: ['csv', 'json']
        }
      },
      options: {
        connectionTable: {
          describe: 'Connection and table in format {connection}.{table}',
          type: 'string'
        },
        format: {
          describe: 'Export format (csv, json)',
          type: 'string',
          default: 'json',
          choices: ['csv', 'json']
        },
        path: {
          describe: 'Path to export file (alternative to --file)',
          type: 'string'
        },
        file: {
          describe: 'Path to export file (alternative to --path)',
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
      
      // Build query to select all from table
      let query;
      let params = [];
      
      if (db.driver === 'pgsql') {
        query = `SELECT * FROM "${table}"`;
      } else if (db.driver === 'mysql') {
        query = `SELECT * FROM ??`;
        params = [table];
      } else {
        query = `SELECT * FROM "${table}"`;
      }
      
      const results = await db.query(query, params);
      
      // Determine output file path
      let outputPath = argv.file || argv.path;
      if (!outputPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputPath = `${table}_${timestamp}.${argv.format}`;
      }
      
      // Ensure directory exists
      const dirPath = path.dirname(outputPath);
      await fs.mkdir(dirPath, { recursive: true });
      
      // Format and write data based on format
      let data;
      switch (argv.format) {
        case 'json':
          data = JSON.stringify(results, null, 2);
          break;
        case 'csv':
          data = this.formatCsvData(results);
          break;
        default:
          throw new Error(`Unsupported format: ${argv.format}`);
      }
      
      await fs.writeFile(outputPath, data);
      
      console.log(`✅ Data exported to: ${outputPath}`);
      console.log(`📊 Records exported: ${results.length}`);
      
      await db.close();
    } catch (error) {
      this.log(`Error executing export command: ${error.message}`, 'error');
      throw error;
    }
  }
  
  /**
   * Format data as CSV string
   */
  formatCsvData(results) {
    if (results.length === 0) {
      return '';
    }

    const headers = Object.keys(results[0]);
    let csv = headers.join(',') + '\n';

    results.forEach(row => {
      const values = headers.map(header => {
        let value = row[header];
        if (value === null || value === undefined) {
          return '';
        }
        value = String(value);
        // Escape commas and wrap in quotes if needed
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csv += values.join(',') + '\n';
    });
    
    return csv;
  }
}