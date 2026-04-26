import DatabaseAdapter from '../interfaces/DatabaseAdapter.js';
import PgPoolManager from './PgPoolManager.js';

class PgSQLAdapter extends DatabaseAdapter {
  constructor(config = {}) {
    super();
    this.poolManager = new PgPoolManager(config);
    this.pool = this.poolManager.getPool();
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async testConnection() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
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

export default PgSQLAdapter;