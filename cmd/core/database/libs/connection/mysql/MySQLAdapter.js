import mysql from 'mysql2/promise';
import DatabaseAdapter from '../interfaces/DatabaseAdapter.js';

class MySQLAdapter extends DatabaseAdapter {
  constructor(config = {}) {
    super();
    this.connection = null;

    this.config = {
      host: config.host || process.env.OFF_DB_HOST || '127.0.0.1',
      port: config.port || Number(process.env.OFF_DB_PORT || 3306),
      user: config.user || process.env.OFF_DB_USERNAME || 'root',
      password: config.password || process.env.OFF_DB_PASSWORD || '',
      database: config.database || process.env.OFF_DB_NAME || 'ean',
      charset: 'utf8mb4',
      timezone: '+00:00',
    };
  }

  async _connect() {
    if (!this.connection) {
      this.connection = await mysql.createConnection(this.config);
    }
    return this.connection;
  }

  async query(sql, params = []) {
    const conn = await this._connect();

    if (
      sql.trim().toUpperCase().startsWith('USE ') ||
      sql.trim().toUpperCase().startsWith('CREATE DATABASE') ||
      sql.trim().toUpperCase().startsWith('DROP DATABASE')
    ) {
      const [rows] = await conn.query(sql);
      return rows;
    }

    const [rows] = await conn.execute(sql, params);
    return rows;
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
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }

  getStats() {
    return {
      connected: !!this.connection,
      driver: 'mysql',
    };
  }
}

export default MySQLAdapter;