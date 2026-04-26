/**
 * Utilidad reutilizable para detectar dependencias circulares en grafos de dependencias.
 * 
 * Usa un algoritmo DFS (Depth-First Search) con coloreo de nodos para detectar ciclos:
 * - WHITE (0): Nodo no visitado
 * - GRAY (1): Nodo siendo visitado (en el stack actual)
 * - BLACK (2): Nodo completamente visitado
 * 
 * @example
 * import { CircularDependencyDetector } from './lib/CircularDependencyDetector.js';
 * 
 * const graph = new Map([
 *   ['A', new Set(['B'])],
 *   ['B', new Set(['C'])],
 *   ['C', new Set(['A'])]
 * ]);
 * 
 * const result = CircularDependencyDetector.detectCircularDependencies(graph);
 * if (result.hasCycle) {
 *   console.log('Cycles found:', result.cycles);
 * }
 */
export class CircularDependencyDetector {
  
  static COLORS = {
    WHITE: 0,
    GRAY: 1,
    BLACK: 2
  };

  /**
   * Detecta dependencias circulares en un grafo de dependencias.
   * 
   * @param {Map<string, Set<string>>} graph - Mapa donde cada key es un nodo y el value es un Set de sus dependencias
   * @returns {{ hasCycle: boolean, cycles: string[][], visitedNodes: number }} 
   *          - hasCycle: true si se detectaron ciclos
   *          - cycles: array de arrays, cada uno representa un camino que forma un ciclo
   *          - visitedNodes: cantidad de nodos visitados (para debugging/stats)
   */
  static detectCircularDependencies(graph) {
    const color = new Map();
    const parent = new Map();
    const cycles = [];
    let visitedNodes = 0;

    // Inicializar todos los nodos como WHITE (no visitados)
    for (const node of graph.keys()) {
      color.set(node, CircularDependencyDetector.COLORS.WHITE);
      parent.set(node, null);
    }

    // Ejecutar DFS desde cada nodo no visitado
    for (const node of graph.keys()) {
      if (color.get(node) === CircularDependencyDetector.COLORS.WHITE) {
        visitedNodes += this.dfsVisit(node, graph, color, parent, cycles);
      }
    }

    return {
      hasCycle: cycles.length > 0,
      cycles,
      visitedNodes
    };
  }

  /**
   * Visita DFS que detect ciclos usando coloreo de nodos.
   * 
   * @returns {number} Cantidad de nodos visitados en esta traversada
   */
  static dfsVisit(node, graph, color, parent, cycles) {
    let visitedCount = 0;
    
    // Marcar nodo como GRAY (siendo visitado)
    color.set(node, CircularDependencyDetector.COLORS.GRAY);
    visitedCount++;

    const dependencies = graph.get(node) || new Set();
    
    for (const dependency of dependencies) {
      // Si la dependencia no existe en el grafo, ignorarla (dependencia externa o typo)
      if (!graph.has(dependency)) {
        continue;
      }

      if (color.get(dependency) === CircularDependencyDetector.COLORS.GRAY) {
        // ¡Ciclo detectado! Reconstruir el camino del ciclo
        const cycle = this.reconstructCycle(dependency, node, parent);
        cycles.push(cycle);
      } else if (color.get(dependency) === CircularDependencyDetector.COLORS.WHITE) {
        parent.set(dependency, node);
        visitedCount += this.dfsVisit(dependency, graph, color, parent, cycles);
      }
      // Si es BLACK, ya fue completamente visitado, ignorar
    }

    // Marcar nodo como BLACK (completamente visitado)
    color.set(node, CircularDependencyDetector.COLORS.BLACK);
    
    return visitedCount;
  }

  /**
   * Reconstruye el camino del ciclo desde el nodo de inicio hasta el nodo actual.
   * 
   * @param {string} startNode - Nodo donde comienza el ciclo
   * @param {string} currentNode - Nodo actual que cerró el ciclo
   * @param {Map<string, string>} parent - Mapa de padres para reconstruir el camino
   * @returns {string[]} Array de nodos que forman el ciclo
   */
  static reconstructCycle(startNode, currentNode, parent) {
    const cycle = [startNode];
    let current = currentNode;

    // Seguir los padres hacia atrás hasta llegar al nodo de inicio
    while (current !== startNode && current !== null) {
      cycle.unshift(current);
      current = parent.get(current);
    }

    // Agregar el nodo de inicio al final para cerrar el ciclo
    if (cycle[0] === startNode && cycle[cycle.length - 1] !== startNode) {
      cycle.push(startNode);
    }

    return cycle;
  }

  /**
   * Valida si un grafo de dependencias tiene ciclos.
   * Versión simplificada que solo retorna boolean.
   * 
   * @param {Map<string, Set<string>>} graph 
   * @returns {boolean} true si tiene ciclos, false si es un DAG (Directed Acyclic Graph)
   */
  static hasCircularDependencies(graph) {
    const result = this.detectCircularDependencies(graph);
    return result.hasCycle;
  }

  /**
   * Formatea los ciclos detectados para mostrarlos al usuario.
   * 
   * @param {string[][]} cycles - Array de ciclos detectados
   * @returns {string[]} Array de strings formateados para mostrar
   */
  static formatCycles(cycles) {
    return cycles.map(cycle => cycle.join(' → '));
  }
}
