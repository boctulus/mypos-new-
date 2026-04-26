import { BaseCommand } from '../../core/libs/BaseCommand.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Clase base para comandos de manejo de archivos
 * Proporciona utilidades para listados, patrones glob y exclusión
 */
export class FileBaseCommand extends BaseCommand {
  constructor() {
    super();
    this.group = 'file';
  }

  /**
   * Normaliza una ruta de directorio
   * - Resuelve '.' al cwd
   * - NO añade trailing slash (causa problemas con statSync y path.join)
   */
  normalizePath(dir) {
    if (dir === '.' || dir === './') {
      dir = process.cwd();
    }
    return path.resolve(dir);
  }

  /**
   * Convierte un patrón con separadores múltiples (|) en un array de patrones
   * Ej: '*.java|*.xml' → ['*.java', '*.xml']
   */
  splitPattern(pattern) {
    if (!pattern || pattern === '*' || pattern === '*.*') {
      return ['*'];
    }
    return pattern.split('|').map(p => p.trim()).filter(p => p.length > 0);
  }

  /**
   * Verifica si una ruta coincide con algún patrón de exclusión
   * Soporta fnmatch-style patterns con comodines.
   * Si el patrón no contiene separadores de ruta, se compara solo
   * contra el nombre del archivo (basename), no contra la ruta completa.
   */
  matchesExcludePattern(filePath, excludePatterns) {
    if (!excludePatterns || excludePatterns.length === 0) {
      return false;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const basename = path.basename(normalizedPath).replace(/\\/g, '/');

    for (const excludePattern of excludePatterns) {
      const normalizedExclude = excludePattern.replace(/\\/g, '/');

      // Si el patrón no contiene '/', comparar solo contra el basename
      if (!normalizedExclude.includes('/')) {
        if (this.fnmatch(normalizedExclude, basename)) {
          return true;
        }
      } else {
        // Patrón con ruta: comparar contra la ruta completa
        if (this.fnmatch(normalizedExclude, normalizedPath)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Simple fnmatch-style pattern matching con soporte para *, **, ?
   */
  fnmatch(pattern, str) {
    // Escape special regex chars except glob wildcards
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*')
      .replace(/\?/g, '[^/]');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }

  /**
   * Lista archivos en un directorio (no recursivo)
   * Soporta múltiples patrones separados por |
   * Solo retorna archivos (no directorios)
   */
  listFilesFlat(dir, patterns, excludePatterns = []) {
    const results = [];

    for (const pattern of patterns) {
      const fullPath = path.join(dir, pattern);
      const matches = this._globFilesOnly(fullPath, excludePatterns);
      results.push(...matches);
    }

    // Deduplicate
    return [...new Set(results)];
  }

  /**
   * Lista archivos recursivamente
   * Soporta múltiples patrones y exclusión
   * Solo retorna archivos (no directorios)
   */
  listFilesRecursive(dir, patterns, excludePatterns = []) {
    const results = [];

    for (const pattern of patterns) {
      const matches = this._recursiveGlobFiles(dir, pattern, excludePatterns);
      results.push(...matches);
    }

    // Deduplicate
    return [...new Set(results)];
  }

  /**
   * Glob que solo retorna archivos (no directorios)
   */
  _globFilesOnly(fullPath, excludePatterns) {
    let matchesArray;
    try {
      const iterator = fs.globSync(fullPath, { nodir: true });
      matchesArray = [...iterator];
    } catch (e) {
      return [];
    }

    if (excludePatterns.length === 0) {
      return matchesArray;
    }

    return matchesArray.filter(file => !this.matchesExcludePattern(file, excludePatterns));
  }

  /**
   * Implementación recursiva de glob solo para archivos
   */
  _recursiveGlobFiles(rootDir, pattern, excludePatterns) {
    const results = [];
    this._walkAndGlobFiles(rootDir, pattern, excludePatterns, results);
    return results;
  }

  /**
   * Walk directory tree and glob for files only
   */
  _walkAndGlobFiles(currentDir, pattern, excludePatterns, results) {
    try {
      // Match files in current directory
      const fullPath = path.join(currentDir, pattern);
      const fileMatches = this._globFilesOnly(fullPath, excludePatterns);
      results.push(...fileMatches);

      // Recurse into subdirectories
      const subDirs = fs.readdirSync(currentDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => path.join(currentDir, dirent.name));

      for (const subDir of subDirs) {
        this._walkAndGlobFiles(subDir, pattern, excludePatterns, results);
      }
    } catch (e) {
      // Ignore permission errors, etc.
    }
  }

  /**
   * Lista entradas de un directorio (archivos + directorios)
   * Soporta filtrado por patterns (solo aplica a archivos, no directorios)
   * y exclusión de paths
   */
  listEntriesWithDirs(dir, recursive = false, excludePatterns = []) {
    const results = [];

    if (recursive) {
      this._deepScan(dir, results, excludePatterns);
    } else {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.' || entry.name === '..') continue;
          const fullPath = path.join(dir, entry.name);
          if (!this.matchesExcludePattern(fullPath, excludePatterns)) {
            results.push(fullPath);
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }

    return results;
  }

  /**
   * Escaneo profundo recursivo con soporte de exclusión
   */
  _deepScan(dir, results, excludePatterns = []) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue;

        const fullPath = path.join(dir, entry.name);

        if (this.matchesExcludePattern(fullPath, excludePatterns)) {
          // Skip excluded paths, but still recurse into non-excluded subdirs
          if (entry.isDirectory()) {
            // Check if the directory itself is excluded; if so, don't descend
            continue;
          }
          continue;
        }

        results.push(fullPath);

        if (entry.isDirectory()) {
          this._deepScan(fullPath, results, excludePatterns);
        }
      }
    } catch (e) {
      // Ignore permission errors
    }
  }
}
