import { SkillBaseCommand } from './SkillBaseCommand.js';
import path from 'path';

/**
 * Comando para crear archivos SKILL.md
 */
export class CreateCommand extends SkillBaseCommand {
  constructor() {
    super();
    this.command = 'create';
    this.description = 'Crea un archivo SKILL.md en el directorio especificado';
    this.examples = [
      'node com skill create "My New Skill"',
      'node com skill create "Another Skill" --dir=claude',
      'node com skill create "Advanced Skill" --dir=.agent'
    ];
    this.aliases = {
      'create': ['new', 'add']
    };
  }

  /**
   * Configuración del comando
   */
  static get config() {
    return {
      requiredArgs: ['name'],
      optionalArgs: ['dir', 'force'],
      validation: {
        name: { required: true }
      },
      options: {
        dir: {
          describe: 'Directorio donde crear el skill (por defecto .agent)',
          type: 'string',
          default: '.agent'
        },
        force: {
          describe: 'Sobrescribir el skill si ya existe',
          type: 'boolean',
          default: false
        }
      }
    };
  }

  /**
   * Configuración específica de yargs para este comando
   */
  configure(yargs) {
    const config = this.constructor.config;
    
    // Definir argumentos posicionales
    yargs.positional('name', {
      describe: 'Nombre del skill a crear',
      type: 'string'
    });
    
    // Aplicar opciones
    if (config.options) {
      Object.entries(config.options).forEach(([key, option]) => {
        yargs.option(key, option);
      });
    }
    
    return yargs;
  }

  /**
   * Validaciones específicas del comando
   */
  validate(argv) {
    if (!argv.name && Array.isArray(argv._) && argv._.length > 0) {
      argv.name = argv._[0];
    }

    if (!argv.name || String(argv.name).trim().length === 0) {
      this.log('❌ El nombre del skill es requerido', 'error');
      return false;
    }

    return true;
  }

  /**
   * Lógica principal del comando
   */
  async execute(argv) {
    try {
      this.log('🚀 Iniciando creación de skill...', 'info');

      const skillName = String(argv.name).trim();
      let directory = argv.dir || '.agent';
      const force = Boolean(argv.force);

      // Asegurar que el directorio comience con punto si no lo tiene
      if (!directory.startsWith('.')) {
        directory = '.' + directory;
      }

      // Convertir el nombre a kebab-case
      const kebabCaseName = this.toKebabCase(skillName);

      // Crear la ruta completa
      const skillDir = path.join(directory, 'skills', kebabCaseName);
      const skillFilePath = path.join(skillDir, 'SKILL.md');

      // Verificar si el skill ya existe
      if (await this.fileExists(skillFilePath) && !force) {
        this.log(`❌ El skill ya existe: ${skillFilePath}`, 'error');
        this.log(`💡 Usa --force para sobrescribirlo`, 'info');
        return;
      }

      // Asegurar que el directorio exista
      await this.ensureDirectoryExists(skillDir);

      // Contenido del archivo SKILL.md
      const skillContent = `---
name: ${kebabCaseName}
description:
---

# SKILL_DEFINITION: ${skillName}
`;

      // Escribir el archivo
      await this.writeFile(skillFilePath, skillContent, force);

      this.log(`✅ Skill creado exitosamente!`, 'success');
      this.log(`📁 Ruta: ${skillFilePath}`, 'info');
      this.log(`🏷️ Nombre: ${skillName}`, 'info');
      this.log(`🏷️ Nombre en kebab-case: ${kebabCaseName}`, 'info');
      this.log(`🏠 Directorio: ${directory}`, 'info');
    } catch (error) {
      this.log(`❌ Error creando skill: ${error.message}`, 'error');
      throw error;
    }
  }
}