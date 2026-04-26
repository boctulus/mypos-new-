import DatabaseAdapter from './interfaces/DatabaseAdapter.js';
import mysql from 'mysql2/promise';

class MySQLConnection extends DatabaseAdapter {
    constructor(config = {}) {
        super();
        this.connection = null;
        this.config = {
            host: config.host || process.env.OFF_DB_HOST || '127.0.0.1',
            port: config.port || parseInt(process.env.OFF_DB_PORT || '3306'),
            user: config.user || process.env.OFF_DB_USERNAME || 'root',
            password: config.password || process.env.OFF_DB_PASSWORD || '',
            database: config.database || process.env.OFF_DB_NAME || 'ean',
            charset: config.charset || 'utf8mb4',
            timezone: config.timezone || '+00:00',
            ...config
        };
    }

    async _connect() {
        if (!this.connection) {
            this.connection = await mysql.createConnection(this.config);
        }
        return this.connection;
    }

    async query(sql, params = []) {
        try {
            const connection = await this._connect();

            // Use query() for commands that don't support prepared statements
            if (sql.trim().toUpperCase().startsWith('USE ') ||
                sql.trim().toUpperCase().startsWith('CREATE DATABASE') ||
                sql.trim().toUpperCase().startsWith('DROP DATABASE')) {
                const [rows] = await connection.query(sql);
                return rows;
            }

            // Use execute() for regular queries (supports prepared statements)
            const [rows] = await connection.execute(sql, params);
            return rows;
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
            console.error('❌ Database test failed:', error.message);
            return false;
        }
    }

    async close() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
            console.log('🔌 Database disconnected');
        }
    }

    getStats() {
        return {
            connected: !!this.connection,
            driver: 'mysql',
        };
    }
}

export default MySQLConnection;