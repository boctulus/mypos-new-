/**
 * DatabaseAdapter
 *
 * Contrato mínimo para cualquier motor de base de datos.
 * No expone pools, conexiones ni detalles de implementación.
 */
class DatabaseAdapter {
  /**
   * Ejecuta una consulta SQL
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Array>}
   */
  async query(sql, params = []) {
    throw new Error('query() must be implemented');
  }

  /**
   * Verifica conectividad
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }

  /**
   * Libera recursos (opcional)
   */
  async close() {
    // optional
  }

  /**
   * Estadísticas internas (opcional)
   */
  getStats() {
    return {};
  }
}

export default DatabaseAdapter;