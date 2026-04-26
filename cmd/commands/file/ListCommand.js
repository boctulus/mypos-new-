import { FileBaseCommand } from './FileBaseCommand.js';
import fs from 'fs';
import path from 'path';

export class ListCommand extends FileBaseCommand {
  constructor() {
    super();
    this.command = 'list';
    this.description = 'Lista archivos y/o directorios según las opciones proporcionadas';
    this.examples = [
      "node com file list D:\\path\\to\\dir",
      "node com file list D:\\path\\to\\dir --recursive",
      "node com file list D:\\path\\to\\dir --include-dirs --recursive",
      "node com file list D:\\path\\to\\dir --only-dirs --recursive",
      "node com file list D:\\path\\to\\dir --recursive --pattern='*.json'",
      "node com file list . --pattern='*.bat'",
      "node com file list . --pattern='*.bat' --recursive",
      "node com file list D:\\path\\to\\dir --recursive --pattern='*.java|*.xml|*.gradle' --exclude='**/build/**'",
    ];
  }

  static get config() {
    return {
      positional: ['dir'],
      optionalArgs: ['pattern', 'recursive', 'include-dirs', 'only-dirs', 'exclude'],
      options: {
        dir: {
          describe: 'Directorio a listar',
          type: 'string'
        },
        pattern: {
          describe: "Filter by pattern (e.g., '*.js', '*.java|*.xml')",
          type: 'string',
          default: '*'
        },
        recursive: {
          describe: 'Search recursively in subdirectories',
          type: 'boolean',
          default: false
        },
        'include-dirs': {
          describe: 'Include directories in the list',
          type: 'boolean',
          default: false
        },
        'only-dirs': {
          describe: 'List only directories',
          type: 'boolean',
          default: false
        },
        exclude: {
          describe: 'Exclude paths matching pattern (supports glob wildcards)',
          type: 'string',
          default: ''
        }
      }
    };
  }

  validate(argv) {
    const dir = argv.dir || (argv._ && argv._[0]);

    if (!dir) {
      console.error("❌ Error: El argumento 'dir' es requerido");
      process.exit(1);
      return false;
    }

    const normalizedDir = this.normalizePath(dir);

    if (!fs.existsSync(normalizedDir)) {
      console.error(`❌ Error: El directorio '${dir}' no existe`);
      process.exit(1);
      return false;
    }

    if (!fs.statSync(normalizedDir).isDirectory()) {
      console.error(`❌ Error: '${dir}' no es un directorio válido`);
      process.exit(1);
      return false;
    }

    return true;
  }

  async execute(argv) {
    try {
      const dir = argv.dir || (argv._ && argv._[0]);
      const normalizedDir = this.normalizePath(dir);

      const patterns = this.splitPattern(argv.pattern || '*');
      const excludePatterns = argv.exclude ? argv.exclude.split('|').map(p => p.trim()).filter(p => p) : [];
      const recursive = !!argv.recursive;
      const includeDirs = !!argv['include-dirs'];
      const onlyDirs = !!argv['only-dirs'];

      let entries = [];

      if (onlyDirs) {
        // Only directories: get all entries, filter to dirs only
        const allEntries = this.listEntriesWithDirs(normalizedDir, recursive, excludePatterns);
        entries = allEntries.filter(entry => {
          try {
            return fs.statSync(entry).isDirectory();
          } catch {
            return false;
          }
        });
      } else if (includeDirs) {
        // Files + directories, with pattern filtering on files only
        const allEntries = this.listEntriesWithDirs(normalizedDir, recursive, excludePatterns);

        for (const entry of allEntries) {
          try {
            const stat = fs.statSync(entry);
            if (stat.isDirectory()) {
              // Always include directories when --include-dirs
              entries.push(entry);
            } else {
              // Filter files by pattern
              const fileName = path.basename(entry);
              if (this.matchesAnyPattern(fileName, patterns)) {
                entries.push(entry);
              }
            }
          } catch {
            // Skip entries that can't be stat'd
          }
        }
      } else {
        // Files only (default), with pattern and exclude
        if (recursive) {
          entries = this.listFilesRecursive(normalizedDir, patterns, excludePatterns);
        } else {
          entries = this.listFilesFlat(normalizedDir, patterns, excludePatterns);
        }
      }

      // Normalize output (convert backslashes to forward slashes for Windows compatibility)
      const normalizedEntries = entries.map(entry => entry.replace(/\\/g, '/'));

      // Print results
      for (const entry of normalizedEntries) {
        console.log(entry);
      }

    } catch (error) {
      this.log(`Error ejecutando list: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Check if a filename matches any of the given patterns
   */
  matchesAnyPattern(filename, patterns) {
    for (const pattern of patterns) {
      if (pattern === '*' || pattern === '*.*') {
        return true;
      }
      if (this._simpleGlobMatch(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matcher for pattern filtering.
   * '*' matches any characters (including dots).
   * '*.ext' matches any filename ending in .ext.
   */
  _simpleGlobMatch(filename, pattern) {
    if (pattern === '*' || pattern === '*.*') return true;

    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '.*')
      .replace(/___DOUBLESTAR___/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(filename);
  }

  getHelp() {
    const help = super.getHelp();
    return {
      ...help,
      examples: this.examples
    };
  }
}
