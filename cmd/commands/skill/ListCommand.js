import { SkillBaseCommand } from './SkillBaseCommand.js';
import path from 'path';

/**
 * Comando para listar skills en los directorios de agentes
 */
export class ListCommand extends SkillBaseCommand {
  constructor() {
    super();
    this.command = 'list';
    this.description = 'Lista los skills disponibles en el directorio del agente';
    this.examples = [
      'node com skill list',
      'node com skill list --agent=claude',
      'node com skill list --agent=qwen',
      'node com skill list --detailed',
      'node com skill list --agent=claude --detailed'
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
      optionalArgs: ['agent', 'detailed'],
      validation: {},
      options: {
        agent: {
          describe: 'Directorio del agente (agent, claude, qwen)',
          type: 'string',
          default: 'agent'
        },
        detailed: {
          describe: 'Mostrar información detallada (descripción y tamaño)',
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

    if (config.options) {
      Object.entries(config.options).forEach(([key, option]) => {
        yargs.option(key, option);
      });
    }

    return yargs;
  }

  /**
   * Lógica principal del comando
   */
  async execute(argv) {
    try {
      const agent = argv.agent || 'agent';
      const detailed = argv.detailed || false;

      // Resolver directorio del agente
      const agentDir = this.getAgentDir(agent);

      // Obtener skills
      const skills = await this.getSkillsDirectory(agentDir);

      if (skills.length === 0) {
        this.log(`⚠️ No se encontraron skills en ${agentDir}/skills/`, 'warning');
        return;
      }

      this.log(`📋 Skills en \`${agentDir}/skills/\` (${skills.length} total):`, 'success');
      console.log('');

      if (detailed) {
        // Modo detallado: mostrar descripción y tamaño
        for (const skill of skills) {
          const skillFilePath = path.join(skill.path, 'SKILL.md');
          const frontmatter = await this.parseSkillFrontmatter(skillFilePath);
          const sizeKB = await this.getFileSizeKB(skillFilePath);

          // Nombre del skill (del frontmatter o del directorio)
          const skillName = frontmatter?.name || skill.name;
          const description = frontmatter?.description || 'Sin descripción';
          const sizeStr = sizeKB ? `${sizeKB} KB` : 'N/A';

          console.log(`  🔹 ${skillName}`);
          console.log(`     📄 Descripción: ${description}`);
          console.log(`     📦 Tamaño: ${sizeStr}`);
          console.log('');
        }
      } else {
        // Modo simple: solo nombres
        for (const skill of skills) {
          console.log(`  🔹 ${skill.name}`);
        }
        console.log('');
      }
    } catch (error) {
      this.log(`❌ Error listando skills: ${error.message}`, 'error');
      throw error;
    }
  }
}
