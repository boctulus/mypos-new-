import { readFile } from 'fs/promises';
import pathModule from 'path';

/**
 * Helper para manejo de JSON en la aplicación
 */
export class JSONHelper {
    static async loadJSON(relativePath) {
        const absolutePath = pathModule.resolve(process.cwd(), relativePath);
        return JSON.parse(await readFile(absolutePath));
    }

    /**
   * Convierte datos a formato JSON seguro
   * @param {Object} data - Datos a convertir
   * @returns {String} - JSON en formato string
   */
  static stringify(data) {
    try {
      return JSON.stringify(data);
    } catch (error) {
      console.error('Error al convertir a JSON:', error);
      return '{}';
    }
  }

  /**
   * Parsea un string JSON a objeto
   * @param {String} jsonString - String JSON a parsear
   * @param {Object} defaultValue - Valor por defecto si hay error
   * @returns {Object} - Objeto parseado o valor por defecto
   */
  static parse(jsonString, defaultValue = {}) {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Error al parsear JSON:', error);
      return defaultValue;
    }
  }

  /**
   * Valida un objeto JSON contra un esquema simple
   * @param {Object} data - Datos a validar
   * @param {Object} schema - Esquema de validación {campo: tipo}
   * @returns {boolean} - true si válido, false si no
   */
  static validate(data, schema) {
    if (!data || typeof data !== 'object') return false;
    
    for (const [key, type] of Object.entries(schema)) {
      // Verificar si existe la propiedad
      if (!(key in data)) return false;
      
      // Verificar el tipo
      if (typeof data[key] !== type) return false;
    }
    
    return true;
  }
}
