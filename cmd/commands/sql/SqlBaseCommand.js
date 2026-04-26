// CRITICAL: Load environment variables FIRST before any other imports
// This ensures databases.config.js reads the correct env values
import EnvLoader from '../../core/libs/EnvLoader.js';
EnvLoader.load();

import { BaseCommand } from '../../core/libs/BaseCommand.js';
// databasesConfig will be loaded dynamically to ensure EnvLoader has run
let databasesConfig = null;

import mysql from 'mysql2/promise';
import { PostgresReader } from '../../core/database/libs/readers/PostgresReader.js';
import MySQLAdapter from '../../core/database/libs/connection/mysql/MySQLAdapter.js';
import DatabaseFactory from '../../core/database/DatabaseFactory.js';
import pkg from 'sqlite3';
const { Database: SQLite3Database } = pkg;

/**
 * Base class for SQL commands
 */
export class SqlBaseCommand extends BaseCommand {
  constructor() {
    super();
    this.group = 'sql';
  }

  /**
   * Get database connection based on connection name
   */
  async getConnection(connectionName) {
    if (!databasesConfig) {
      databasesConfig = (await import('../../config/databases.config.js')).default;
    }
    const connections = databasesConfig.db_connections;

    if (!connections[connectionName]) {
      throw new Error(`Connection '${connectionName}' not found in databases.config.js`);
    }

    const config = connections[connectionName];

    switch (config.driver) {
      case 'mysql':
        return await this.createMysqlConnection(config);
      case 'pgsql':
        return await this.createPgConnection({ ...config, connectionName });
      case 'sqlite':
        return await this.createSqliteConnection(config);
      default:
        throw new Error(`Unsupported database driver: ${config.driver}`);
    }
  }

  /**
   * Create MySQL connection
   */
  async createMysqlConnection(config) {
    const mysqlAdapter = new MySQLAdapter({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.pass,
      database: config.db_name,
      charset: config.charset
    });

    return {
      driver: 'mysql',
      query: async (sql, params = []) => {
        return await mysqlAdapter.query(sql, params);
      },
      close: async () => {
        await mysqlAdapter.close();
      }
    };
  }

  /**
   * Create PostgreSQL connection using PostgresReader
   */
  async createPgConnection(config) {
    // Create adapter using the factory
    const dbAdapter = DatabaseFactory.create({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.pass,
      database: config.db_name,
      driver: 'pgsql'
    });

    const pgReader = new PostgresReader(dbAdapter, {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.pass,
      database: config.db_name,
      schema: config.schema || 'public'
    });

    return {
      driver: 'pgsql',
      connectionName: config.connectionName || 'main',
      query: async (sql, params = []) => {
        // Use the reader's query method which goes through the adapter
        return await pgReader._executeQuery(sql, params);
      },
      close: async () => {
        await pgReader.close();
      }
    };
  }

  /**
   * Create SQLite connection
   */
  async createSqliteConnection(config) {
    const db = new SQLite3Database(config.db_name);

    return {
      driver: 'sqlite',
      query: (sql, params = []) => {
        return new Promise((resolve, reject) => {
          if (sql.trim().toUpperCase().startsWith('SELECT')) {
            db.all(sql, params, (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          } else {
            db.run(sql, params, function (err) {
              if (err) reject(err);
              else resolve([{ changes: this.changes }]);
            });
          }
        });
      },
      close: () => {
        return new Promise((resolve, reject) => {
          db.close(err => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    };
  }

  /**
   * Parse connection.table string
   */
  parseConnectionTable(connectionTable) {
    // Remove leading/trailing quotes if present
    const cleanString = connectionTable.replace(/^['"]|['"]$/g, '');
    const parts = cleanString.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid format. Expected 'connection.table', got '${connectionTable}'`);
    }
    return { connection: parts[0], table: parts[1] };
  }

  /**
   * Format results as table
   */
  formatAsTable(results) {
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.table(results);
  }

  /**
   * Format results as JSON
   */
  formatAsJson(results) {
    console.log(JSON.stringify(results, null, 2));
  }

  /**
   * Format results as CSV
   */
  formatAsCsv(results) {
    if (results.length === 0) {
      console.log('');
      return;
    }

    const headers = Object.keys(results[0]);
    console.log(headers.join(','));

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
      console.log(values.join(','));
    });
  }

  /**
   * Format results as lines with ID first
   */
  formatAsLines(results) {
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    results.forEach((row, index) => {
      if (index > 0) {
        console.log(''); // Empty line between records
      }

      // Find the ID field (could be 'id' or another primary key field)
      const fields = Object.keys(row);
      let idField = 'id';

      // Look for a field that might be the ID field
      for (const field of fields) {
        if (field.toLowerCase() === 'id' ||
          field.toLowerCase().endsWith('_id') ||
          field.toLowerCase().startsWith('id_')) {
          idField = field;
          break;
        }
      }

      // Print ID field first
      if (row.hasOwnProperty(idField)) {
        console.log(`${idField}:${row[idField]}`);
      }

      // Sort remaining fields alphabetically
      const otherFields = fields
        .filter(field => field !== idField)
        .sort();

      // Print other fields
      otherFields.forEach(field => {
        console.log(`${field}:${row[field]}`);
      });
    });
  }

  /**
   * Validate SQL query to prevent dangerous operations
   */
  validateQuery(sql, allowDestructive = false) {
    const upperSql = sql.trim().toUpperCase();

    // Check for potentially dangerous operations
    const destructiveKeywords = ['DROP', 'TRUNCATE', 'DELETE', 'UPDATE'];
    const hasDestructive = destructiveKeywords.some(keyword =>
      upperSql.includes(keyword) &&
      !upperSql.startsWith('SELECT')
    );

    if (hasDestructive && !allowDestructive) {
      throw new Error(`Potentially destructive operation detected. Use --force or --confirm flag to proceed.`);
    }

    return true;
  }
}