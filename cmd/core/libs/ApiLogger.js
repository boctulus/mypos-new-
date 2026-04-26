/**
 * ApiLogger
 *
 * Utilidad para registrar requests y responses de APIs en archivos de log
 * para debugging y auditoría.
 *
 * @author Pablo Bozzolo (boctulus)
 * @date 2025-11-28
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ApiLogger {
  constructor(logDir = null) {
    // Directorio de logs (por defecto: logs/ en la raíz del proyecto)
    this.logDir = logDir || path.join(__dirname, '..', '..', 'logs');
    this.initialized = false;
  }

  /**
   * Inicializa el directorio de logs
   */
  async init() {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.logDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('[ApiLogger] Error creando directorio de logs:', error);
    }
  }

  /**
   * Genera nombre de archivo de log basado en la fecha
   * @param {String} prefix - Prefijo del archivo (ej: 'openfactura', 'taxpayer')
   * @returns {String}
   */
  getLogFilename(prefix = 'api') {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${prefix}_${year}-${month}-${day}.log`;
  }

  /**
   * Formatea un objeto para el log
   * @param {Object} obj
   * @returns {String}
   */
  formatObject(obj) {
    if (typeof obj === 'string') {
      return obj;
    }

    try {
      return JSON.stringify(obj, null, 2);
    } catch (error) {
      return String(obj);
    }
  }

  /**
   * Sanitiza datos sensibles antes de loguear
   * @param {Object} data
   * @returns {Object}
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = JSON.parse(JSON.stringify(data));

    // Campos sensibles a ocultar
    const sensitiveFields = [
      'password',
      'api_key',
      'apiKey',
      'token',
      'authorization',
      'secret',
      'private_key',
      'privateKey'
    ];

    const sanitizeObject = (obj) => {
      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * Registra un request HTTP
   * @param {String} method - GET, POST, etc.
   * @param {String} url - URL completa o endpoint
   * @param {Object} options - Headers, body, etc.
   * @param {String} prefix - Prefijo del archivo de log
   */
  async logRequest(method, url, options = {}, prefix = 'api') {
    await this.init();

    const timestamp = new Date().toISOString();
    const logFile = path.join(this.logDir, this.getLogFilename(prefix));

    const sanitizedOptions = this.sanitizeData(options);

    const logEntry = [
      '',
      '=' .repeat(80),
      `[REQUEST] ${timestamp}`,
      '=' .repeat(80),
      `Method: ${method}`,
      `URL: ${url}`,
      '',
      'Headers:',
      this.formatObject(sanitizedOptions.headers || {}),
      '',
      'Body:',
      this.formatObject(sanitizedOptions.data || sanitizedOptions.body || 'N/A'),
      '',
      '-' .repeat(80),
      ''
    ].join('\n');

    try {
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error('[ApiLogger] Error escribiendo request log:', error);
    }
  }

  /**
   * Registra un response HTTP
   * @param {Number} status - Código HTTP
   * @param {Object} data - Datos de respuesta
   * @param {Object} headers - Headers de respuesta
   * @param {String} prefix - Prefijo del archivo de log
   */
  async logResponse(status, data, headers = {}, prefix = 'api') {
    await this.init();

    const timestamp = new Date().toISOString();
    const logFile = path.join(this.logDir, this.getLogFilename(prefix));

    const sanitizedData = this.sanitizeData(data);
    const sanitizedHeaders = this.sanitizeData(headers);

    const logEntry = [
      `[RESPONSE] ${timestamp}`,
      `Status: ${status}`,
      '',
      'Headers:',
      this.formatObject(sanitizedHeaders),
      '',
      'Body:',
      this.formatObject(sanitizedData),
      '',
      '=' .repeat(80),
      ''
    ].join('\n');

    try {
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      console.error('[ApiLogger] Error escribiendo response log:', error);
    }
  }

  /**
   * Registra un error
   * @param {Error} error
   * @param {Object} context - Contexto adicional
   * @param {String} prefix - Prefijo del archivo de log
   */
  async logError(error, context = {}, prefix = 'api') {
    await this.init();

    const timestamp = new Date().toISOString();
    const logFile = path.join(this.logDir, this.getLogFilename(prefix));

    const sanitizedContext = this.sanitizeData(context);

    const logEntry = [
      '',
      '!' .repeat(80),
      `[ERROR] ${timestamp}`,
      '!' .repeat(80),
      `Message: ${error.message}`,
      '',
      'Stack:',
      error.stack || 'N/A',
      '',
      'Context:',
      this.formatObject(sanitizedContext),
      '',
      '!' .repeat(80),
      ''
    ].join('\n');

    try {
      await fs.appendFile(logFile, logEntry);
    } catch (writeError) {
      console.error('[ApiLogger] Error escribiendo error log:', writeError);
    }
  }

  /**
   * Registra una transacción completa (request + response)
   * @param {String} method
   * @param {String} url
   * @param {Object} requestOptions
   * @param {Number} status
   * @param {Object} responseData
   * @param {Object} responseHeaders
   * @param {String} prefix
   */
  async logTransaction(method, url, requestOptions, status, responseData, responseHeaders, prefix = 'api') {
    await this.logRequest(method, url, requestOptions, prefix);
    await this.logResponse(status, responseData, responseHeaders, prefix);
  }

  /**
   * Limpia logs antiguos
   * @param {Number} daysToKeep - Días de logs a mantener
   */
  async cleanOldLogs(daysToKeep = 30) {
    await this.init();

    try {
      const files = await fs.readdir(this.logDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(this.logDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAge) {
          await fs.unlink(filePath);
          console.log(`[ApiLogger] Log antiguo eliminado: ${file}`);
        }
      }
    } catch (error) {
      console.error('[ApiLogger] Error limpiando logs antiguos:', error);
    }
  }
}

// Exportar instancia singleton
const apiLogger = new ApiLogger();

export default apiLogger;
