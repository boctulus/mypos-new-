import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import globPkg from 'glob';
const { glob } = globPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * ProductionCleaner - Elimina archivos especificados en .keepclean en producción
 */
export class ProductionCleaner {
  constructor(rootPath = PROJECT_ROOT) {
    this.rootPath = rootPath;
    this.keepcleanPath = path.join(rootPath, '.keepclean');
  }

  /**
   * Lee y parsea el archivo .keepclean
   * @returns {Promise<string[]>} Array de patrones a eliminar
   */
  async readKeepCleanFile() {
    try {
      const content = await fs.readFile(this.keepcleanPath, 'utf8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // Ignorar comentarios y líneas vacías
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📄 No se encontró archivo .keepclean, omitiendo limpieza');
        return [];
      }
      throw error;
    }
  }

  /**
   * Encuentra archivos que coinciden con los patrones
   * @param {string[]} patterns - Patrones de archivos a buscar
   * @returns {Promise<string[]>} Array de rutas de archivos encontrados
   */
  async findFilesToDelete(patterns) {
    const filesToDelete = new Set();
    
    for (const pattern of patterns) {
      // Manejar patrones de negación (que empiezan con !)
      if (pattern.startsWith('!')) {
        const negPattern = pattern.slice(1);
        const matches = await new Promise((resolve, reject) => {
          glob(negPattern, { 
            cwd: this.rootPath,
            dot: true,
            absolute: true 
          }, (err, files) => {
            if (err) reject(err);
            else resolve(files);
          });
        });
        // Remover archivos que coinciden con patrones de negación
        matches.forEach(match => filesToDelete.delete(match));
        continue;
      }

      try {
        const matches = await new Promise((resolve, reject) => {
          glob(pattern, { 
            cwd: this.rootPath,
            dot: true,
            absolute: true 
          }, (err, files) => {
            if (err) reject(err);
            else resolve(files);
          });
        });
        matches.forEach(match => filesToDelete.add(match));
      } catch (error) {
        console.warn(`⚠️  Patrón inválido '${pattern}': ${error.message}`);
      }
    }

    return Array.from(filesToDelete);
  }

  /**
   * Elimina un archivo o directorio
   * @param {string} filePath - Ruta del archivo/directorio a eliminar
   */
  async deleteFileOrDirectory(filePath) {
    try {
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
        console.log(`🗂️  Directorio eliminado: ${path.relative(this.rootPath, filePath)}`);
      } else {
        await fs.unlink(filePath);
        console.log(`📄 Archivo eliminado: ${path.relative(this.rootPath, filePath)}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️  Error eliminando ${filePath}: ${error.message}`);
      }
    }
  }

  /**
   * Ejecuta la limpieza de producción
   * @param {boolean} dryRun - Si es true, solo muestra qué se eliminaría sin hacerlo
   */
  async clean(dryRun = false) {
    const startTime = Date.now();
    console.log('🧹 Iniciando limpieza de producción...');
    
    try {
      const patterns = await this.readKeepCleanFile();
      
      if (patterns.length === 0) {
        console.log('📋 No hay patrones definidos en .keepclean');
        return { deleted: 0, patterns: 0 };
      }

      console.log(`📋 Procesando ${patterns.length} patrón(es) de limpieza`);
      
      const filesToDelete = await this.findFilesToDelete(patterns);
      
      if (filesToDelete.length === 0) {
        console.log('✨ No se encontraron archivos para eliminar');
        return { deleted: 0, patterns: patterns.length };
      }

      console.log(`🎯 Encontrados ${filesToDelete.length} archivo(s)/directorio(s) para eliminar`);

      if (dryRun) {
        console.log('🔍 Modo DRY RUN - Se eliminarían:');
        filesToDelete.forEach(file => {
          console.log(`  - ${path.relative(this.rootPath, file)}`);
        });
        return { deleted: 0, patterns: patterns.length, found: filesToDelete.length };
      }

      // Eliminar archivos
      let deletedCount = 0;
      for (const filePath of filesToDelete) {
        await this.deleteFileOrDirectory(filePath);
        deletedCount++;
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Limpieza completada en ${duration}ms - ${deletedCount} elemento(s) eliminado(s)`);
      
      return { deleted: deletedCount, patterns: patterns.length };

    } catch (error) {
      console.error('❌ Error durante la limpieza de producción:', error);
      throw error;
    }
  }

  /**
   * Verifica si debería ejecutarse la limpieza según el entorno
   * @returns {boolean}
   */
  static shouldClean() {
    const nodeEnv = process.env.NODE_ENV;
    return nodeEnv === 'production' || nodeEnv === 'prod';
  }
}

export default ProductionCleaner;