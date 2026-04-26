/**
 * Clase base transversal para todos los comandos del sistema
 */
export class BaseCommand {
  constructor() {
    this.group = 'general';
    this.command = '';
    this.description = '';
    this.examples = [];
    this.aliases = {};
    this.keepAlive = false; // Si es true, no ejecuta process.exit() al finalizar
  }

  /**
   * Configuración del comando (validaciones, argumentos requeridos, etc.)
   */
  static get config() {
    return {
      requiredArgs: [],
      optionalArgs: [],
      validation: {},
      options: {}
    };
  }

  /**
   * Método principal que debe ser implementado por cada comando
   */
  async execute(argv) {
    throw new Error(`execute() must be implemented in ${this.constructor.name}`);
  }

  /**
   * Configuración específica de yargs para este comando
   */
  configure(yargs) {
    const config = this.constructor.config;
    
    // Configurar parámetros posicionales si existen
    if (config.positional) {
      config.positional.forEach((param) => {
        const option = config.options && config.options[param];
        yargs.positional(param, {
          describe: option ? option.describe : `Parámetro ${param}`,
          type: option ? option.type : 'string'
        });
      });
    }
    
    // Aplicar opciones si existen
    if (config.options) {
      Object.entries(config.options).forEach(([key, option]) => {
        yargs.option(key, option);
      });
    }

    return yargs;
  }

  /**
   * Validación centralizada de argumentos
   */
  validate(argv) {
    const config = this.constructor.config;
    
    // Validar argumentos requeridos
    for (const arg of config.requiredArgs || []) {
      if (!argv[arg] && !argv[arg.replace(/-/g, '')]) {
        console.error(`❌ Error: El argumento '${arg}' es requerido`);
        return false;
      }
    }

    // Validaciones específicas
    if (config.validation) {
      for (const [field, rule] of Object.entries(config.validation)) {
        if (!this.validateField(argv[field], rule, field)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validación de campos individuales
   */
  validateField(value, rule, fieldName) {
    if (!value) return true; // Campo opcional

    if (typeof rule === 'string') {
      switch (rule) {
        case 'email':
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            console.error(`❌ Error: '${fieldName}' debe ser un email válido`);
            return false;
          }
          break;
      }
    }

    if (typeof rule === 'object') {
      if (rule.minLength && value.length < rule.minLength) {
        console.error(`❌ Error: '${fieldName}' debe tener al menos ${rule.minLength} caracteres`);
        return false;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        console.error(`❌ Error: '${fieldName}' no puede tener más de ${rule.maxLength} caracteres`);
        return false;
      }
    }

    return true;
  }

  /**
   * Información de ayuda del comando
   */
  getHelp() {
    return {
      group: this.group,
      command: this.command,
      description: this.description,
      examples: this.examples,
      aliases: this.aliases,
      config: this.constructor.config
    };
  }

  /**
   * Utilidad para logging consistente
   */
  log(message, type = 'info') {
    const prefix = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warning: '⚠️'
    };
    console.log(`${prefix[type]} ${message}`);
  }
}