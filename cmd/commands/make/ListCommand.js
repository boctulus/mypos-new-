/* Ruta: D:\nodejs\friendlypos_nodejs\commands\make\ListCommand.js */
import { MakeBaseCommand } from './MakeBaseCommand.js';
import path from 'path';

/**
 * Comando para listar grupos y comandos existentes
 */
export class ListCommand extends MakeBaseCommand {
  constructor() {
    super();
    this.command = 'list';
    this.description = 'Lista todos los grupos y comandos existentes en el proyecto';
    this.examples = [
      'node com make list',
      'node com make list --group=users',
      'node com make list --detailed',
      '',
      '# IMPORTANTE: El comando "list" respeta la configuración de BASE_PATH en el .env',
      '# Si BASE_PATH="../llc-builder", listará comandos de ese proyecto, no del actual',
      '# Ejemplo de uso con el proyecto según BASE_PATH:',
      'node com make list --group=llm'
    ];
    this.aliases = {
      'list': ['ls', 'show']
    };
  }

  /**
   * Configuración del comando
   */
  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: ['group', 'detailed'],
      validation: {},
      options: {
        group: {
          describe: 'Mostrar solo comandos de un grupo específico',
          type: 'string'
        },
        detailed: {
          describe: 'Mostrar información detallada',
          type: 'boolean',
          default: false
        }
      }
    };
  }

  /**
   * Lógica principal del comando
   */
  async execute(argv) {
    try {
      this.log('📋 Listando estructura de comandos...', 'info');

      const groups = await this.getExistingGroups();
      
      if (groups.length === 0) {
        this.log('⚠️ No se encontraron grupos de comandos', 'warning');
        return;
      }

      if (argv.group) {
        await this.showGroupDetails(argv.group, argv.detailed);
      } else {
        await this.showAllGroups(groups, argv.detailed);
      }

    } catch (error) {
      this.log(`❌ Error listando comandos: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Muestra todos los grupos con sus comandos
   */
  async showAllGroups(groups, detailed = false) {
    this.log(`\n🗂️ Grupos de comandos encontrados: ${groups.length}\n`, 'info');

    for (const group of groups) {
      const commands = await this.getExistingCommandsInGroup(group);
      const hasBaseCommand = await this.hasBaseCommand(group);
      
      console.log(`📁 ${group} ${hasBaseCommand ? '(con BaseCommand)' : ''}`);
      
      if (commands.length === 0) {
        console.log(`   └── (sin comandos)`);
      } else {
        commands.forEach((cmd, index) => {
          const isLast = index === commands.length - 1;
          console.log(`   ${isLast ? '└──' : '├──'} ${cmd}`);
        });
      }

      if (detailed) {
        console.log(`   Directorio: ${path.join(this.commandsDir, group)}`);
        console.log(`   Comandos: ${commands.length}`);
      }
      
      console.log('');
    }

    this.log('💡 Usa --group=<nombre> para ver detalles de un grupo específico', 'info');
  }

  /**
   * Muestra detalles de un grupo específico
   */
  async showGroupDetails(groupName, detailed = false) {
    const groups = await this.getExistingGroups();
    
    if (!groups.includes(groupName)) {
      this.log(`❌ El grupo "${groupName}" no existe`, 'error');
      this.log(`Grupos disponibles: ${groups.join(', ')}`, 'info');
      return;
    }

    const commands = await this.getExistingCommandsInGroup(groupName);
    const hasBaseCommand = await this.hasBaseCommand(groupName);
    const groupDir = path.join(this.commandsDir, groupName);

    this.log(`\n📁 Detalles del grupo: ${groupName}\n`, 'info');
    console.log(`Directorio: ${groupDir}`);
    console.log(`BaseCommand: ${hasBaseCommand ? '✅ Sí' : '❌ No'}`);
    console.log(`Total comandos: ${commands.length}`);
    console.log('');

    if (commands.length === 0) {
      console.log('└── (sin comandos)');
    } else {
      console.log('Comandos:');
      for (const [index, cmd] of commands.entries()) {
        const isLast = index === commands.length - 1;
        console.log(`${isLast ? '└──' : '├──'} ${cmd}`);
        
        if (detailed) {
          const cmdFile = `${this.toPascalCase(cmd)}Command.js`;
          const cmdPath = path.join(groupDir, cmdFile);
          console.log(`${isLast ? '   ' : '│  '} └── ${cmdFile}`);
        }
      }
    }

    console.log('');
    this.log(`💡 Ejecuta: node com ${groupName} <comando> --help para ver ayuda`, 'info');
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