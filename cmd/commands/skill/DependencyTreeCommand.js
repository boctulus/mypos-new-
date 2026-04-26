import { SkillBaseCommand } from './SkillBaseCommand.js';
import path from 'path';
import { CircularDependencyDetector } from './lib/CircularDependencyDetector.js';

/**
 * Comando para mostrar el árbol de dependencias entre skills
 */
export class DependencyTreeCommand extends SkillBaseCommand {
  constructor() {
    super();
    this.command = 'dependency-tree';
    this.description = 'Muestra el árbol de dependencias entre skills';
    this.examples = [
      'node com skill dependency-tree',
      'node com skill dependency-tree --agent=claude',
      'node com skill dependency-tree --skill=view-lifecycle-protocol',
      'node com skill dependency-tree --skill=view-lifecycle-protocol --full',
      'node com skill dependency-tree --agent=qwen --skill=code-quality-protocol'
    ];
    this.aliases = {
      'dependency-tree': ['deps', 'dependencies']
    };
  }

  /**
   * Configuración del comando
   */
  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: ['skill', 'agent', 'full'],
      validation: {},
      options: {
        skill: {
          describe: 'Mostrar dependencias solo para un skill específico',
          type: 'string'
        },
        agent: {
          describe: 'Directorio del agente (agent, claude, qwen)',
          type: 'string',
          default: 'agent'
        },
        full: {
          describe: 'Cuando se usa con --skill, muestra dependencias upstream y downstream',
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
      const skillFilter = argv.skill || null;
      const showFull = argv.full || false;

      // Resolver directorio del agente
      const agentDir = this.getAgentDir(agent);

      // Obtener todos los skills
      const skills = await this.getSkillsDirectory(agentDir);

      if (skills.length === 0) {
        this.log(`⚠️ No se encontraron skills en ${agentDir}/skills/`, 'warning');
        return;
      }

      // Construir grafo de dependencias
      const dependencyGraph = await this.buildDependencyGraph(skills);

      // Si se especificó un skill, validar que exista
      if (skillFilter) {
        const normalizedFilter = this.normalizeSkillName(skillFilter);
        const skillExists = skills.some(s => this.normalizeSkillName(s.name) === normalizedFilter);
        
        if (!skillExists) {
          this.log(`❌ Skill '${skillFilter}' no encontrado en ${agentDir}/skills/`, 'error');
          this.log(`Skills disponibles:`, 'info');
          skills.forEach(s => console.log(`  🔹 ${s.name}`));
          return;
        }
      }

      // Detectar dependencias circulares
      const cycleDetection = CircularDependencyDetector.detectCircularDependencies(dependencyGraph);

      // Mostrar el árbol de dependencias
      this.log(`🌳 Skill Dependency Tree (${agent})`, 'success');
      this.log(`📊 ${skills.length} skills scanned, ${this.countEdges(dependencyGraph)} dependencies mapped`, 'info');
      console.log('');

      if (cycleDetection.hasCycle) {
        this.log(`⚠️ Circular dependencies detected! (${cycleDetection.cycles.length} cycle${cycleDetection.cycles.length > 1 ? 's' : ''})`, 'warning');
        const formattedCycles = CircularDependencyDetector.formatCycles(cycleDetection.cycles);
        formattedCycles.forEach((cycle, index) => {
          console.log(`   🔸 Cycle ${index + 1}: ${cycle}`);
        });
        console.log('');
      } else {
        this.log(`✅ No circular dependencies detected`, 'success');
        console.log('');
      }

      // Mostrar árbol
      if (skillFilter) {
        // Mostrar para un skill específico
        const normalizedFilter = this.normalizeSkillName(skillFilter);
        const targetSkill = skills.find(s => this.normalizeSkillName(s.name) === normalizedFilter);
        
        console.log(`📦 ${targetSkill.name}`);
        
        // Mostrar dependencias upstream (lo que requiere)
        const upstreamDeps = dependencyGraph.get(targetSkill.name) || new Set();
        if (upstreamDeps.size > 0) {
          console.log(`  └─ 📥 Upstream dependencies (${upstreamDeps.size}):`);
          this.printTree(Array.from(upstreamDeps), dependencyGraph, '    ', new Set(), targetSkill.name);
        } else {
          console.log(`  └─ 📥 Upstream dependencies: none`);
        }

        // Si --full, mostrar también downstream (quién depende de este skill)
        if (showFull) {
          const downstreamDeps = this.findDownstreamDependencies(targetSkill.name, dependencyGraph);
          if (downstreamDeps.length > 0) {
            console.log(`  └─ 📤 Downstream dependencies (${downstreamDeps.length}):`);
            this.printTree(downstreamDeps, dependencyGraph, '    ', new Set(), targetSkill.name);
          } else {
            console.log(`  └─ 📤 Downstream dependencies: none`);
          }
        }
      } else {
        // Mostrar todos los skills con sus dependencias
        const skillsWithDeps = skills.filter(s => {
          const deps = dependencyGraph.get(s.name);
          return deps && deps.size > 0;
        });

        const skillsWithoutDeps = skills.filter(s => {
          const deps = dependencyGraph.get(s.name);
          return !deps || deps.size === 0;
        });

        if (skillsWithDeps.length > 0) {
          this.log(`📦 Skills with dependencies:`, 'info');
          console.log('');
          
          for (const skill of skillsWithDeps) {
            const deps = dependencyGraph.get(skill.name);
            console.log(`📦 ${skill.name}`);
            this.printTree(Array.from(deps), dependencyGraph, '  ', new Set([skill.name]), skill.name);
            console.log('');
          }
        }

        if (skillsWithoutDeps.length > 0) {
          this.log(`📦 Skills without dependencies (${skillsWithoutDeps.length}):`, 'info');
          console.log('');
          for (const skill of skillsWithoutDeps) {
            console.log(`  🔹 ${skill.name}`);
          }
          console.log('');
        }
      }

      // Resumen
      this.log(`📊 Summary:`, 'info');
      console.log(`   Total skills: ${skills.length}`);
      console.log(`   Total dependencies: ${this.countEdges(dependencyGraph)}`);
      console.log(`   Circular dependencies: ${cycleDetection.cycles.length}`);
      console.log(`   Visited nodes: ${cycleDetection.visitedNodes}`);
      console.log('');

    } catch (error) {
      this.log(`❌ Error building dependency tree: ${error.message}`, 'error');
      throw error;
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
   * Busca en las secciones semánticamente equivalentes de dependencias:
   * - REQUIRES (HARD DEPENDENCIES)
   * - SKILLS USED (loaded and applied during execution — NOT pre-conditions)
   * - Complementary Skills
   * - Related Skills
   * - SKILL ORDER EXECUTION
   *
   * @param {string} content - Contenido del SKILL.md
   * @returns {Set<string>} Set de nombres de skills dependientes
   */
  extractDependencies(content) {
    const dependencies = new Set();

    // Secciones que declaran dependencias de skills (bullet list con kebab-case)
    const bulletSectionPatterns = [
      /## REQUIRES\s*\(HARD DEPENDENCIES\)\s*\n([\s\S]*?)(?=##|$)/i,
      /## SKILLS USED\s*[\s\S]*?\n([\s\S]*?)(?=##|$)/i,
      /## Complementary Skills\s*\n([\s\S]*?)(?=##|$)/i,
      /## Related Skills\s*\n([\s\S]*?)(?=##|$)/i,
    ];

    for (const sectionRegex of bulletSectionPatterns) {
      const sectionMatch = content.match(sectionRegex);
      if (sectionMatch) {
        const section = sectionMatch[1];
        const skillPattern = /^-\s+([a-z][a-z0-9-]*)/gm;
        let match;
        while ((match = skillPattern.exec(section)) !== null) {
          dependencies.add(match[1]);
        }
      }
    }

    // Extraer de la sección SKILL ORDER EXECUTION (lista numerada)
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

  /**
   * Encuentra las dependencias downstream (quién depende de este skill)
   * 
   * @param {string} skillName - Nombre del skill
   * @param {Map<string, Set<string>>} graph - Grafo de dependencias
   * @returns {string[]} Lista de skills que dependen de este
   */
  findDownstreamDependencies(skillName, graph) {
    const downstream = [];

    for (const [skill, deps] of graph.entries()) {
      if (deps.has(skillName)) {
        downstream.push(skill);
      }
    }

    return downstream.sort();
  }

  /**
   * Imprime un árbol de dependencias de forma recursiva
   * 
   * @param {string[]} deps - Lista de dependencias a imprimir
   * @param {Map<string, Set<string>>} graph - Grafo completo
   * @param {string} prefix - Prefijo para indentación
   * @param {Set<string>} visited - Nodos ya visitados (para evitar recursión infinita)
   * @param {string} rootSkill - Skill raíz (para evitar mostrarlo como referencia circular)
   */
  printTree(deps, graph, prefix, visited, rootSkill = null) {
    const sortedDeps = deps.sort();
    
    sortedDeps.forEach((dep, index) => {
      const isLast = index === sortedDeps.length - 1;
      const connector = isLast ? '└─' : '├─';
      const icon = graph.has(dep) && graph.get(dep).size > 0 ? '📦' : '📄';
      
      console.log(`${prefix}${connector} ${icon} ${dep}`);

      // Recursivamente imprimir dependencias del hijo si no fue visitado
      // O si es el rootSkill (para evitar marcar como circular cuando aparece en downstream)
      if (!visited.has(dep) && dep !== rootSkill) {
        const childDeps = graph.get(dep);
        if (childDeps && childDeps.size > 0) {
          visited.add(dep);
          const childPrefix = isLast ? `${prefix}  ` : `${prefix}│ `;
          this.printTree(Array.from(childDeps), graph, childPrefix, visited, rootSkill);
        }
      } else if (dep === rootSkill) {
        // No marcar el rootSkill como circular cuando aparece en downstream
        // Simplemente no hacer nada (ya está impreso)
      } else if (visited.has(dep)) {
        // Ya visitado en este árbol - es una dependencia compartida, no un ciclo real
        console.log(`${prefix}   (already shown ↑)`);
      }
    });
  }

  /**
   * Normaliza el nombre de un skill para comparación (kebab-case)
   */
  normalizeSkillName(name) {
    return this.toKebabCase(name);
  }

  /**
   * Cuenta el total de edges en el grafo
   */
  countEdges(graph) {
    let count = 0;
    for (const deps of graph.values()) {
      count += deps.size;
    }
    return count;
  }
}
