import { FileBaseCommand } from './FileBaseCommand.js';
import fs from 'fs';
import path from 'path';

/**
 * Verifica si un archivo o directorio existe.
 * Exit code 0 si existe, exit code 1 si no existe.
 */
export class ExistsCommand extends FileBaseCommand {
  constructor() {
    super();
    this.command = 'exists';
    this.description = 'Verifica si un archivo o directorio existe (exit 0 si existe, exit 1 si no)';
    this.examples = [
      'node com file exists path/to/file.txt',
      'node com file exists path/to/dir',
      'node com file exists .',
      'node com file exists C:\\some\\path\\file.js',
    ];
    this.aliases = {
      'exists': ['exist', 'is', 'test']
    };
  }

  static get config() {
    return {
      positional: ['path'],
      optionalArgs: ['type'],
      options: {
        path: {
          describe: 'Ruta del archivo o directorio a verificar',
          type: 'string'
        },
        type: {
          describe: 'Tipo esperado: "file", "dir", o "any"',
          type: 'string',
          choices: ['file', 'dir', 'any'],
          default: 'any'
        }
      }
    };
  }

  validate(argv) {
    const filePath = argv.path || (argv._ && argv._[0]);

    if (!filePath) {
      console.error("❌ Error: El argumento 'path' es requerido");
      process.exit(1);
      return false;
    }

    return true;
  }

  async execute(argv) {
    const filePath = argv.path || (argv._ && argv._[0]);
    const expectedType = argv.type || 'any';
    const normalizedPath = path.resolve(filePath);

    if (!fs.existsSync(normalizedPath)) {
      console.log(`false`);
      process.exit(1);
      return;
    }

    const stat = fs.statSync(normalizedPath);

    if (expectedType === 'file' && !stat.isFile()) {
      console.log(`false`);
      process.exit(1);
      return;
    }

    if (expectedType === 'dir' && !stat.isDirectory()) {
      console.log(`false`);
      process.exit(1);
      return;
    }

    console.log(`true`);
    process.exit(0);
  }

  getHelp() {
    const help = super.getHelp();
    return {
      ...help,
      examples: this.examples
    };
  }
}
