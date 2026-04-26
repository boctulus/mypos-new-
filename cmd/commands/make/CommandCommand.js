import { MakeBaseCommand } from './MakeBaseCommand.js';
import path from 'path';
import EnvLoader from '../../core/libs/EnvLoader.js';

// Cargar variables de entorno si no se han cargado
if (!EnvLoader.isLoaded()) {
  EnvLoader.load();
}

/**
 * Comando para generar scaffolding de nuevos comandos y grupos
 */
export class CommandCommand extends MakeBaseCommand {
  constructor() {
    super();
    this.command = 'command';
    this.description = 'Genera scaffolding para nuevos comandos y grupos';
    this.examples = [
      '# Crear un nuevo grupo de comandos',
      'node com make command --new-group=llm --description="Comandos para proveedores de LLM"',

      '# Crear un comando dentro de un grupo existente',
      'node com make command --group=llm --name=ollama-list --description="Lista todos los modelos disponibles de Ollama"',

      '# Crear múltiples comandos a la vez',
      'node com make command --group=llm --name=ollama-list,ollama-prompt --description="Comandos para Ollama"',

      '# Crear un comando con formato de especificación (grupo:comando)',
      'node com make command llm:openai-chat --description="Comando para chat con OpenAI"',

      '# Crear un comando con BaseCommand para el grupo (para lógica compartida)',
      'node com make command --new-group=ai --name=chat --base-command --description="Comando de chat AI"',

      '# Sobrescribir un archivo si ya existe',
      'node com make command --group=llm --name=ollama-status --force --description="Estado del servicio Ollama"'
    ];
    this.aliases = {
      'command': ['cmd', 'new', 'generate']
    };
  }

  /**
   * Configuración del comando
   */
  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: ['group', 'new-group', 'name', 'description', 'base-command', 'force'],
      validation: {
        name: { minLength: 2 }
      },
      options: {
        group: {
          describe: 'Grupo existente donde crear el comando',
          type: 'string'
        },
        'new-group': {
          describe: 'Crear un nuevo grupo con este nombre',
          type: 'string'
        },
        name: {
          describe: 'Nombre del comando a crear (puede usar kebab-case, camelCase o PascalCase)',
          type: 'string'
        },
        description: {
          describe: 'Descripción del comando',
          type: 'string',
          default: ''
        },
        'base-command': {
          describe: 'Crear también un BaseCommand para el grupo',
          type: 'boolean',
          default: false
        },
        force: {
          describe: 'Sobrescribir archivos existentes',
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
    yargs.positional('spec', {
      describe: 'Especificación del grupo y comandos en formato grupo:comando1,comando2',
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
  async validateCommand(argv) {
    // Verificar si hay un argumento posicional en argv._ y asignarlo a spec si no existe
    if (!argv.spec && argv._ && argv._.length > 0) {
      argv.spec = argv._[0];
    }

    // Si no hay spec ni name ni new-group ni group solo, error
    if (!argv.spec && !argv.name && !argv['new-group'] && !argv.group) {
      this.log('❌ Debes especificar al menos --group, --name, --new-group o un spec en formato grupo:comando', 'error');
      return false;
    }

    // Validar formato de nombre si se especifica
    if (argv.name) {
      const commandNames = this.parseCommandNames(argv.name);
      for (const cmd of commandNames) {
        if (cmd.length < 2) {
          this.log(`❌ El nombre del comando '${cmd}' debe tener al menos 2 caracteres`, 'error');
          return false;
        }
      }
    }

    // Validar que no se usen ambos group y new-group
    if (argv.group && argv['new-group']) {
      this.log('❌ No puedes especificar --group y --new-group al mismo tiempo', 'error');
      return false;
    }

    // Validar que el grupo existe si se especifica --group
    if (argv.group) {
      const existingGroups = await this.getExistingGroups();
      if (!existingGroups.includes(argv.group)) {
        this.log(`❌ El grupo "${argv.group}" no existe. Grupos disponibles: ${existingGroups.join(', ')}`, 'error');
        this.log('💡 Usa --new-group para crear un nuevo grupo', 'info');
        return false;
      }
    }

    return true;
  }

  parseCommandNames(input) {
    return input.split(',').map(cmd => cmd.trim()).filter(cmd => cmd);
  }

  /**
   * Lógica principal del comando
   */
  async execute(argv) {
    try {
      this.log('🚀 Iniciando generación de scaffolding...', 'info');

      // Asignar el primer argumento posicional a spec si no existe
      if (!argv.spec && argv._ && argv._.length > 0) {
        argv.spec = argv._[0]; // Tomar el primer argumento posicional
      }

      if (!await this.validateCommand(argv)) {
        return;
      }

      let groupName = argv.group || argv['new-group'];
      let commandNames = [];

      // Parsear spec si existe (formato grupo:comando1,comando2)
      if (argv.spec) {
        const parts = argv.spec.split(':');
        groupName = parts[0].trim();

        // Si solo se especifica el grupo (sin :), crear solo el grupo
        if (parts.length === 1) {
          // Verificar si el grupo existe
          const existingGroups = await this.getExistingGroups();
          if (!existingGroups.includes(groupName)) {
            // Es un nuevo grupo
            argv['new-group'] = groupName;
            groupName = null;
          } else {
            // Es un grupo existente, solo mostrar info
            argv.group = groupName;
          }
        } else {
          // Si hay comandos después de :
          commandNames = this.parseCommandNames(parts[1]);
        }
      }

      // Usar --name si está especificado y no hay spec
      if (argv.name && commandNames.length === 0) {
        commandNames = this.parseCommandNames(argv.name);
      }

      const description = argv.description;
      const shouldCreateBaseCommand = argv['base-command'];
      const force = argv.force;

      this.log(`📝 Configuración:`, 'info');
      if (groupName) {
        this.log(` Grupo: ${groupName}`);
      }
      if (argv['new-group']) {
        this.log(` Nuevo grupo: ${argv['new-group']}`);
      }
      if (commandNames.length > 0) {
        this.log(` Comandos: ${commandNames.join(', ')}`);
      }
      if (description) {
        this.log(` Descripción: ${description}`);
      }
      this.log(` Crear BaseCommand: ${shouldCreateBaseCommand ? 'Sí' : 'No'}`);
      this.log(` Forzar sobrescritura: ${force ? 'Sí' : 'No'}`);

      // Crear nuevo grupo si se especificó
      if (argv['new-group']) {
        await this.createNewGroup(argv['new-group'], shouldCreateBaseCommand, force);
        groupName = argv['new-group']; // Asegurarse de usar el nuevo grupo para los comandos
      }

      // Verificar si necesitamos crear BaseCommand para grupo existente
      if (argv.group && shouldCreateBaseCommand) {
        await this.createBaseCommandIfNotExists(argv.group, force);
      }

      // Crear comandos si se especificaron
      if (commandNames.length > 0) {
        for (const cmdName of commandNames) {
          const commandName = this.toKebabCase(cmdName);
          await this.createCommand(
            groupName,
            commandName,
            description,
            shouldCreateBaseCommand,
            force
          );
        }
        this.log('✅ Scaffolding completado exitosamente!', 'success');
        this.log('', 'info');
        this.log('📋 Siguientes pasos:', 'info');
        this.log(` 1. Edita los archivos generados para implementar la lógica`, 'info');
        for (const cmdName of commandNames) {
          const commandName = this.toKebabCase(cmdName);
          this.log(` 2. Prueba el comando: node com ${groupName} ${commandName} --help`, 'info');
        }
      } else if (argv['new-group']) {
        this.log('✅ Grupo creado exitosamente!', 'success');
        this.log('', 'info');
        this.log('📋 Siguientes pasos:', 'info');
        this.log(` 1. Crea comandos para el nuevo grupo: node com make command ${argv['new-group']}:nombre-comando`, 'info');
      } else if (argv.group && !commandNames.length) {
        // Solo se especificó --group sin comandos
        this.log(`✅ Grupo "${argv.group}" ya existe!`, 'success');
        this.log('', 'info');
        this.log('📋 Siguientes pasos:', 'info');
        this.log(` 1. Crea comandos para este grupo: node com make command ${argv.group}:nombre-comando`, 'info');
      }
    } catch (error) {
      this.log(`❌ Error generando scaffolding: ${error.message}`, 'error');
      throw error;
    }
  }
}
