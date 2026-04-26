import MySQLAdapter from './libs/connection/mysql/MySQLAdapter.js';
import PgSQLAdapter from './libs/connection/pgsql/PgSQLAdapter.js';

/**
 * DatabaseFactory
 *
 * Punto único de creación de adapters de base de datos.
 * Devuelve siempre una instancia que cumple DatabaseAdapter.
 */
class DatabaseFactory {
  static create(config) {
    if (!config?.driver) {
      throw new Error('Database driver is required');
    }

    switch (config.driver) {
      case 'mysql':
        return new MySQLAdapter(config);

      case 'pgsql':
      case 'postgres':
        return new PgSQLAdapter(config);

      default:
        throw new Error(`Database driver not supported: ${config.driver}`);
    }
  }
}

export default DatabaseFactory;