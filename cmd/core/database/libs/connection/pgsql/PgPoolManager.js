import pg from 'pg';
const { Pool } = pg;

class PgPoolManager {
  constructor(defaultConfig = {}) {
    this.defaultConfig = defaultConfig;
    this.pools = new Map();
  }

  _hash(config) {
    const sorted = Object.keys(config).sort().reduce((acc, k) => {
      acc[k] = config[k];
      return acc;
    }, {});
    return JSON.stringify(sorted);
  }

  getPool(config = {}) {
    const finalConfig = { ...this.defaultConfig, ...config };
    const hash = this._hash(finalConfig);

    if (this.pools.has(hash)) {
      return this.pools.get(hash);
    }

    // Filtrar solo las opciones válidas para la conexión de PostgreSQL
    const poolConfig = {
      host: finalConfig.host || 'localhost',
      port: finalConfig.port || 5432,
      user: finalConfig.user || 'postgres',
      password: typeof (finalConfig.password || finalConfig.pass) === 'string'
        ? (finalConfig.password || finalConfig.pass)
        : undefined, // Asegurar que password sea string o undefined
      database: finalConfig.database || finalConfig.db_name || 'postgres',
      max: finalConfig.max || 5,
      idleTimeoutMillis: finalConfig.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: finalConfig.connectionTimeoutMillis || 10000,
    };

    // Solo incluir parámetros si están definidos
    if (finalConfig.ssl) poolConfig.ssl = finalConfig.ssl;
    if (finalConfig.application_name) poolConfig.application_name = finalConfig.application_name;
    if (finalConfig.statement_timeout) poolConfig.statement_timeout = finalConfig.statement_timeout;
    if (finalConfig.connectionTimeoutMillis) poolConfig.connectionTimeoutMillis = finalConfig.connectionTimeoutMillis;
    if (finalConfig.idleTimeoutMillis) poolConfig.idleTimeoutMillis = finalConfig.idleTimeoutMillis;
    if (finalConfig.maxLifetimeSeconds) poolConfig.maxLifetimeSeconds = finalConfig.maxLifetimeSeconds;
    if (finalConfig.keepAlive) poolConfig.keepAlive = finalConfig.keepAlive;

    const pool = new Pool(poolConfig);

    this.pools.set(hash, pool);
    return pool;
  }

  async closeAll() {
    for (const pool of this.pools.values()) {
      await pool.end();
    }
    this.pools.clear();
  }

  getStats() {
    const stats = {};
    for (const [hash, pool] of this.pools) {
      stats[hash] = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      };
    }
    return stats;
  }
}

export default PgPoolManager;