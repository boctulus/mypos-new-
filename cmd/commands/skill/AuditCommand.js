import { SkillBaseCommand } from './SkillBaseCommand.js';
import path from 'path';
import { CircularDependencyDetector } from './lib/CircularDependencyDetector.js';

/**
 * Comando para auditar skills y detectar problemas
 */
export class AuditCommand extends SkillBaseCommand {
  constructor() {
    super();
    this.command = 'audit';
    this.description = 'Audita los skills para detectar problemas (vacíos, sin header, sin descripción, name mismatches, referencias circulares)';
    this.examples = [
      'node com skill audit',
      'node com skill audit --agent=claude',
      'node com skill audit --min-size=100'
    ];
  }

  /**
   * Configuración del comando
   */
  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: ['agent', 'min-size'],
      validation: {},
      options: {
        agent: {
          describe: 'Directorio del agente a auditar (agent, claude, qwen, o "all" para todos)',
          type: 'string',
          default: 'all'
        },
        'min-size': {
          describe: 'Tamaño mínimo en bytes para considerar un skill como sospechoso de estar vacío',
          type: 'number',
          default: 200
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
      const agentFilter = argv.agent || 'all';
      const minSizeBytes = argv['min-size'] || 200;

      // Determinar qué agentes auditar
      const agentsToAudit = agentFilter === 'all' 
        ? ['agent', 'claude', 'qwen']
        : [agentFilter];

      const issues = {
        tooSmall: [],
        missingHeader: [],
        missingDescription: [],
        nameMismatch: [],
        circularDeps: []
      };

      let totalSkills = 0;

      for (const agent of agentsToAudit) {
        const agentDir = this.getAgentDir(agent);
        const skills = await this.getSkillsDirectory(agentDir);
        totalSkills += skills.length;

        for (const skill of skills) {
          const skillFilePath = path.join(skill.path, 'SKILL.md');
          const frontmatter = await this.parseSkillFrontmatter(skillFilePath);
          const stats = await this.getFileStats(skillFilePath);

          // Verificar tamaño
          if (stats && stats.size < minSizeBytes) {
            issues.tooSmall.push({
              agent,
              skillName: skill.name,
              size: stats.size
            });
          }

          // Verificar header
          if (!frontmatter) {
            issues.missingHeader.push({
              agent,
              skillName: skill.name
            });
            continue;
          }

          // Verificar descripción
          if (!frontmatter.description || frontmatter.description.trim() === '') {
            issues.missingDescription.push({
              agent,
              skillName: skill.name
            });
          }

          // Verificar name mismatch
          if (frontmatter.name && frontmatter.name !== skill.name) {
            issues.nameMismatch.push({
              agent,
              skillName: skill.name,
              frontmatterName: frontmatter.name
            });
          }
        }

        // Detectar referencias circulares entre skills
        const dependencyGraph = await this.buildDependencyGraph(skills);
        const cycleDetection = CircularDependencyDetector.detectCircularDependencies(dependencyGraph);

        if (cycleDetection.hasCycle) {
          const formattedCycles = CircularDependencyDetector.formatCycles(cycleDetection.cycles);
          for (const cycle of formattedCycles) {
            issues.circularDeps.push({
              agent,
              cycle
            });
          }
        }
      }

      // Mostrar resultados
      this.log(`🔍 Auditoría completada: ${totalSkills} skills revisados`, 'success');
      console.log('');

      const hasIssues = Object.values(issues).some(arr => arr.length > 0);

      if (!hasIssues) {
        this.log('✅ No se encontraron problemas!', 'success');
        return;
      }

      // Skills demasiado pequeños
      if (issues.tooSmall.length > 0) {
        this.log(`⚠️ Skills sospechosos de estar vacíos (< ${minSizeBytes} bytes): ${issues.tooSmall.length}`, 'warning');
        for (const issue of issues.tooSmall) {
          console.log(`   🔸 [${issue.agent}] ${issue.skillName} (${issue.size} bytes)`);
        }
        console.log('');
      }

      // Skills sin header
      if (issues.missingHeader.length > 0) {
        this.log(`❌ Skills sin header YAML: ${issues.missingHeader.length}`, 'error');
        for (const issue of issues.missingHeader) {
          console.log(`   🔸 [${issue.agent}] ${issue.skillName}`);
        }
        console.log('');
      }

      // Skills sin descripción
      if (issues.missingDescription.length > 0) {
        this.log(`⚠️ Skills sin descripción en el header: ${issues.missingDescription.length}`, 'warning');
        for (const issue of issues.missingDescription) {
          console.log(`   🔸 [${issue.agent}] ${issue.skillName}`);
        }
        console.log('');
      }

      // Name mismatches
      if (issues.nameMismatch.length > 0) {
        this.log(`❌ Skills con name mismatch en el header: ${issues.nameMismatch.length}`, 'error');
        for (const issue of issues.nameMismatch) {
          console.log(`   🔸 [${issue.agent}] ${issue.skillName} → frontmatter dice: "${issue.frontmatterName}"`);
        }
        console.log('');
      }

      // Referencias circulares
      if (issues.circularDeps.length > 0) {
        this.log(`🔄 Skills con referencias circulares: ${issues.circularDeps.length}`, 'error');
        for (const issue of issues.circularDeps) {
          console.log(`   🔸 [${issue.agent}] ${issue.cycle}`);
        }
        console.log('');
      }

      // Resumen
      this.log('📊 Resumen de issues:', 'info');
      console.log(`   🔸 Skills demasiado pequeños: ${issues.tooSmall.length}`);
      console.log(`   🔸 Skills sin header: ${issues.missingHeader.length}`);
      console.log(`   🔸 Skills sin descripción: ${issues.missingDescription.length}`);
      console.log(`   🔸 Skills con name mismatch: ${issues.nameMismatch.length}`);
      console.log(`   🔸 Skills con referencias circulares: ${issues.circularDeps.length}`);
      console.log('');

    } catch (error) {
      this.log(`❌ Error auditando skills: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Obtiene stats de un archivo (incluyendo tamaño en bytes)
   */
  async getFileStats(filePath) {
    try {
      const fs = await import('fs/promises');
      const stats = await fs.stat(filePath);
      return stats;
    } catch (error) {
      return null;
    }
  }

  /**
   * Construye el grafo de dependencias entre skills.
   *
   * @param {Array<{name: string, path: string}>} skills - Lista de skills
   * @returns {Map<string, Set<string>>} Grafo de dependencias
   */
  async buildDependencyGraph(skills) {
    const graph = new Map();

    for (const skill of skills) {
      const skillFilePath = path.join(skill.path, 'SKILL.md');
      const content = await this.readSkillContent(skillFilePath);

      // Extraer dependencias de las secciones REQUIRES y SKILL ORDER EXECUTION
      const dependencies = this.extractDependencies(content);

      graph.set(skill.name, dependencies);
    }

    return graph;
  }

  /**
   * Lee el contenido de un archivo SKILL.md
   */
  async readSkillContent(filePath) {
    const fs = await import('fs/promises');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      return '';
    }
  }

  /**
   * Extrae las dependencias del contenido de un SKILL.md
   * Busca en las secciones "REQUIRES (HARD DEPENDENCIES)" y "SKILL ORDER EXECUTION"
   *
   * @param {string} content - Contenido del SKILL.md
   * @returns {Set<string>} Set de nombres de skills dependientes
   */
  extractDependencies(content) {
    const dependencies = new Set();

    // Extraer de la sección REQUIRES (HARD DEPENDENCIES)
    const requiresSectionMatch = content.match(/## REQUIRES\s*\(HARD DEPENDENCIES\)\s*\n([\s\S]*?)(?=##|$)/i);

    if (requiresSectionMatch) {
      const requiresSection = requiresSectionMatch[1];
      const skillPattern = /^-\s+([a-z][a-z0-9-]*)/gm;
      let match;

      while ((match = skillPattern.exec(requiresSection)) !== null) {
        dependencies.add(match[1]);
      }
    }

    // Extraer de la sección SKILL ORDER EXECUTION
    const orderSectionMatch = content.match(/## SKILL ORDER EXECUTION\s*\n([\s\S]*?)(?=##|$)/i);

    if (orderSectionMatch) {
      const orderSection = orderSectionMatch[1];
      const numberedPattern = /^\d+\.\s+([a-z][a-z0-9-]*)/gm;
      let match;

      while ((match = numberedPattern.exec(orderSection)) !== null) {
        dependencies.add(match[1]);
      }
    }

    return dependencies;
  }
}
