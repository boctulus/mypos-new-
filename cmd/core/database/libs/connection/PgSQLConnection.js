/**
 * PostgreSQL Connection Adapter
 *
 * Implements the DatabaseAdapter interface for PostgreSQL
 *
 * @author Pablo Bozzolo (boctulus)
 */

import DatabaseAdapter from './interfaces/DatabaseAdapter.js';
import PgPoolManager from './pgsql/PgPoolManager.js';

class PgSQLConnection extends DatabaseAdapter {
  constructor(config = {}) {
    super();
    this.poolManager = new PgPoolManager(config);
    this.pool = this.poolManager.getPool();
  }

  async query(sql, params = []) {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Query failed:', error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('❌ PostgreSQL test failed:', error.message);
      return false;
    }
  }

  async close() {
    await this.poolManager.closeAll();
  }

  getStats() {
    return this.poolManager.getStats();
  }
}

export default PgSQLConnection;