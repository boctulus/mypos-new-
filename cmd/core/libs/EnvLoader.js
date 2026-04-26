import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

export default class EnvLoader {
  static #loaded = false; // Private static property to track if env has been loaded
  static #envVars = null; // Store loaded environment variables in memory

  static load(baseDir = null) {
    // Prevent duplicate loading in the same process
    if (this.#loaded) {
      return this.#envVars; // Return cached env vars
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname  = path.dirname(__filename);
    const basePath   = baseDir || path.join(__dirname, '..', '..');

    const NODE_ENV = process.env.NODE_ENV || 'development';
    console.log(`[ENV] Modo de ejecución: ${NODE_ENV}`);

    // Forzar configuración específica de tests
    if (NODE_ENV === 'test') {
      process.env.SESSION_STORE_TYPE = 'memory';
      console.log('[ENV TEST] Forzando SESSION_STORE_TYPE=memory para entorno de pruebas');
    }

    const envPath        = path.join(basePath, '.env');
    const envExamplePath = path.join(basePath, '.env.example');

    // Si no existe .env y existe .env.example, inicializar .env copiando el example
    if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
      try {
        fs.copyFileSync(envExamplePath, envPath);
        console.log('[ENV] Copiado .env.example → .env (inicialización)');
      } catch (err) {
        console.error('[ERROR] No se pudo inicializar .env desde .env.example:', err.message);
      }
    }

    // Cargar SOLO .env
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (result.error) {
        console.error('[ERROR] Error cargando .env:', result.error);
      } else {
        console.log('[ENV] Configuración cargada de .env');
        // Store loaded environment variables in memory
        this.#envVars = { ...process.env };
      }
    } else {
      console.warn('[ENV] No se encontró .env. Puedes crear uno o proveer .env.example para inicialización automática.');
    }

    // Funcionalidades automáticas solo en desarrollo
    if (NODE_ENV === 'development') {
      // Ejecutar createEnvExample solo en Windows
      if (process.platform === 'win32') {
        EnvLoader.createEnvExample(basePath);
      }
      EnvLoader.createBackup(basePath);
    }

    // Mark as loaded to prevent duplicate execution
    this.#loaded = true;
    return this.#envVars;
  }

  /**
   * Get the loaded environment variables from memory
   * @returns {Object|null} The loaded environment variables or null if not loaded
   */
  static getEnvVars() {
    return this.#envVars;
  }

  /**
   * Check if environment has been loaded
   * @returns {boolean} True if environment has been loaded, false otherwise
   */
  static isLoaded() {
    return this.#loaded;
  }

  static createEnvExample(basePath) {
    const envPath        = path.join(basePath, '.env');
    const envExamplePath = path.join(basePath, '.env.example');

    if (!fs.existsSync(envPath)) return;

    try {
      const envContent = fs.readFileSync(envPath, 'utf8');

      // Sanitizar passwords y keys comunes
      const sanitizedContent = envContent
        .split('\n')
        .map(line => {
          if (!line || line.trim().startsWith('#')) return line;

          const sensitive = [
            '_KEY', '_PASSWORD', '_SECRET', '_TOKEN',
            '_APIKEY', '_API_KEY', '_ACCESS_KEY',
            '_PRIVATE_KEY', 'PASSWORD', 'SECRET', 'TOKEN'
          ];

          const hasSensitive = sensitive.some(k => line.includes(`${k}=`));
          if (hasSensitive) {
            const [key] = line.split('=', 1);
            return `${key}=`;
          }
          return line;
        })
        .join('\n');

      fs.writeFileSync(envExamplePath, sanitizedContent, 'utf8');
      console.log('[ENV] Archivo .env.example actualizado automáticamente');
    } catch (error) {
      console.error('[ERROR] Error creando .env.example:', error.message);
    }
  }

  static createBackup(basePath) {
    const envPath = path.join(basePath, '.env');
    if (!fs.existsSync(envPath)) return;

    try {
      const appName   = process.env.APP_NAME || 'app';
      const isWindows = process.platform === 'win32';
      const defaultDir = isWindows ? path.join('c:', 'tmp', appName) : path.join('/tmp', appName);

      const backupDir  = process.env.ENV_BACKUP_DIR || defaultDir;

      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const backupPath = path.join(backupDir, '.env');
      fs.copyFileSync(envPath, backupPath);
      console.log(`[ENV] Backup creado en: ${backupPath}`);
    } catch (error) {
      console.error('[ERROR] Error creando backup:', error.message);
    }
  }
}
