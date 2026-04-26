import { BaseCommand } from '../../core/libs/BaseCommand.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import EnvLoader from '../../core/libs/EnvLoader.js';

// Cargar variables de entorno si no se han cargado
if (!EnvLoader.isLoaded()) {
  EnvLoader.load();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MakeBaseCommand extends BaseCommand {
  constructor() {
    super();
    this.group = 'make';

    // Obtener la ruta base desde la variable de entorno BASE_PATH
    const basePath = process.env.BASE_PATH || '.';

    // Resolver la ruta absoluta relativa al directorio raíz del proyecto
    // Usamos el directorio raíz del proyecto (dos niveles arriba de este archivo)
    const projectRoot = path.resolve(__dirname, '..', '..');
    this.baseDir = path.resolve(projectRoot, basePath);
    this.commandsDir = path.join(this.baseDir, 'commands');
  }

  /**
   * Convierte un string a kebab-case
   */
  toKebabCase(str) {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  /**
   * Convierte un string a PascalCase
   */
  toPascalCase(str) {
    return str
      .split(/[-\s_]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Verifica si un archivo existe
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asegura que un directorio exista, creándolo si es necesario
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      this.log(`📁 Directorio creado: ${dirPath}`, 'success');
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      this.log(`ℹ️ Directorio ya existe: ${dirPath}`, 'info');
    }
  }

  /**
   * Escribe un archivo, opcionalmente sobrescribiendo si existe
   */
  async writeFile(filePath, content, force = false) {
    if (await this.fileExists(filePath) && !force) {
      this.log(`⚠️ El archivo ya existe: ${filePath}`, 'warning');
      return false;
    }
    await fs.writeFile(filePath, content);
    this.log(`📄 Archivo creado: ${filePath}`, 'success');
    return true;
  }

  /**
   * Obtiene la lista de grupos existentes
   */
  async getExistingGroups() {
    const entries = await fs.readdir(this.commandsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  }

  /**
   * Obtiene la lista de comandos en un grupo
   */
  async getExistingCommandsInGroup(groupName) {
    const groupDir = path.join(this.commandsDir, groupName);
    try {
      const files = await fs.readdir(groupDir);
      return files
        .filter(file => file.endsWith('Command.js') && !file.includes('Base'))
        .map(file => this.toKebabCase(file.replace('Command.js', '')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Genera la plantilla para un BaseCommand de grupo
   */
  generateGroupBaseCommandTemplate(groupName) {
    const className = this.toPascalCase(groupName) + 'BaseCommand';
    return `
import { BaseCommand } from '../../core/libs/BaseCommand.js';

export class ${className} extends BaseCommand {
  constructor() {
    super();
    this.group = '${groupName}';
    // Aquí puedes añadir lógica común para los comandos del grupo ${groupName}
  }

  // Ejemplo de método común
  async commonMethod() {
    this.log('Método común para el grupo ${groupName}', 'info');
  }
}
`.trim();
  }

  /**
   * Genera la plantilla para un comando individual
   */
  generateCommandTemplate(groupName, commandName, description, useGroupBaseCommand = false) {
    const className = this.toPascalCase(commandName) + 'Command';
    const baseClass = useGroupBaseCommand
      ? `${this.toPascalCase(groupName)}BaseCommand`
      : 'BaseCommand';
    const importPath = useGroupBaseCommand
      ? `./${this.toPascalCase(groupName)}BaseCommand.js`
      : '../../core/libs/BaseCommand.js'; // Cambiado de ../../libs/BaseCommand.js a ../../core/libs/BaseCommand.js

    return `
import { ${baseClass} } from '${importPath}';

export class ${className} extends ${baseClass} {
  constructor() {
    super();
    this.command = '${commandName}';
    this.description = '${description || 'Descripción del comando'}';
    this.examples = [
      'node com ${groupName} ${commandName} --arg1=valor'
    ];
    this.aliases = {
      '${commandName}': []
    };
  }

  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: [],
      validation: {},
      options: {}
    };
  }

  async execute(argv) {
    this.log('Ejecutando ${commandName}', 'info');
    // Implementa aquí la lógica del comando
  }
}
`.trim();
  }

  /**
 * Crea un nuevo grupo de comandos
 */
async createNewGroup(groupName, createBaseCommand = false, force = false) {
  const groupDir = path.join(this.commandsDir, groupName);
  await this.ensureDirectoryExists(groupDir);
  
  if (createBaseCommand) {
    const baseCommandContent = this.generateGroupBaseCommandTemplate(groupName);
    const baseCommandFile = path.join(groupDir, `${this.toPascalCase(groupName)}BaseCommand.js`);
    await this.writeFile(baseCommandFile, baseCommandContent, force);
  }
}

/**
 * Crea un BaseCommand si no existe
 */
async createBaseCommandIfNotExists(groupName, force = false) {
  const baseCommandFile = path.join(
    this.commandsDir, 
    groupName, 
    `${this.toPascalCase(groupName)}BaseCommand.js`
  );
  
  if (!await this.fileExists(baseCommandFile) || force) {
    const baseCommandContent = this.generateGroupBaseCommandTemplate(groupName);
    await this.writeFile(baseCommandFile, baseCommandContent, force);
  }
}

/**
 * Crea un comando individual
 */
async createCommand(groupName, commandName, description, useGroupBaseCommand = false, force = false) {
  const groupDir = path.join(this.commandsDir, groupName);
  await this.ensureDirectoryExists(groupDir);
  
  // Verificar si existe BaseCommand para el grupo
  const hasBaseCommand = await this.hasBaseCommand(groupName);
  const shouldUseBaseCommand = useGroupBaseCommand && hasBaseCommand;
  
  const commandContent = this.generateCommandTemplate(
    groupName, 
    commandName, 
    description, 
    shouldUseBaseCommand
  );
  
  const commandFile = path.join(groupDir, `${this.toPascalCase(commandName)}Command.js`);
  await this.writeFile(commandFile, commandContent, force);
}

/**
 * Verifica si un grupo tiene BaseCommand
 */
async hasBaseCommand(groupName) {
  const baseCommandPath = path.join(
    this.commandsDir, 
    groupName, 
    `${this.toPascalCase(groupName)}BaseCommand.js`
  );
  return await this.fileExists(baseCommandPath);
}
}
