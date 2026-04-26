import Redis from 'ioredis';

class RedisCache {
  constructor() {
    this.redis = null;
    this.isAvailable = false;
    this.initializeRedis();
  }

  initializeRedis() {
    try {
      // Verificar si Redis está configurado (independiente de las sesiones)
      const redisHost = process.env.REDIS_HOST || '127.0.0.1';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      
      console.log(`[RedisCache] Intentando conectar a Redis en ${redisHost}:${redisPort}...`);

      this.redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0', 10),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true // No conectar inmediatamente
      });

      // Eventos de conexión
      this.redis.on('connect', () => {
        console.log('[RedisCache] Conectado exitosamente');
        this.isAvailable = true;
      });

      this.redis.on('error', (error) => {
        console.warn(`[RedisCache] Error de conexión: ${error.message}`);
        this.isAvailable = false;
      });

      this.redis.on('close', () => {
        console.warn('[RedisCache] Conexión cerrada');
        this.isAvailable = false;
      });

      // Intentar conectar
      this.redis.connect().catch((error) => {
        console.warn(`[RedisCache] No se pudo conectar: ${error.message}`);
        this.isAvailable = false;
      });

    } catch (error) {
      console.warn(`[RedisCache] Error al inicializar: ${error.message}`);
      this.isAvailable = false;
    }
  }

  /**
   * Obtener datos del cache
   * @param {string} key - Clave del cache
   * @returns {Promise<any|null>} - Datos del cache o null si no existe
   */
  async get(key) {
    if (!this.isAvailable || !this.redis) {
      return null;
    }

    try {
      const data = await this.redis.get(`cache:${key}`);
      if (data) {
        console.log(`[RedisCache] Cache hit para: ${key}`);
        return JSON.parse(data);
      }
      console.log(`[RedisCache] Cache miss para: ${key}`);
      return null;
    } catch (error) {
      console.warn(`[RedisCache] Error al obtener ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Guardar datos en el cache
   * @param {string} key - Clave del cache
   * @param {any} data - Datos a guardar
   * @param {number} ttlSeconds - TTL en segundos (por defecto 5 minutos)
   * @returns {Promise<boolean>} - true si se guardó exitosamente
   */
  async set(key, data, ttlSeconds = 300) {
    if (!this.isAvailable || !this.redis) {
      console.log(`[RedisCache] Redis no disponible, no se guarda: ${key}`);
      return false;
    }

    try {
      await this.redis.setex(`cache:${key}`, ttlSeconds, JSON.stringify(data));
      console.log(`[RedisCache] Datos guardados para: ${key} (TTL: ${ttlSeconds}s)`);
      return true;
    } catch (error) {
      console.warn(`[RedisCache] Error al guardar ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Eliminar datos del cache
   * @param {string} key - Clave del cache
   * @returns {Promise<boolean>} - true si se eliminó exitosamente
   */
  async del(key) {
    if (!this.isAvailable || !this.redis) {
      return false;
    }

    try {
      const result = await this.redis.del(`cache:${key}`);
      console.log(`[RedisCache] Cache eliminado para: ${key}`);
      return result > 0;
    } catch (error) {
      console.warn(`[RedisCache] Error al eliminar ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Verificar si Redis está disponible
   * @returns {boolean}
   */
  available() {
    return this.isAvailable;
  }

  /**
   * Cerrar conexión
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
      this.isAvailable = false;
      console.log('[RedisCache] Conexión cerrada');
    }
  }
}

// Exportar una instancia singleton
const redisCache = new RedisCache();
export default redisCache;