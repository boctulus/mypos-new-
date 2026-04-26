import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import tty from './Tty.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CommandRegistry {
  constructor(debug = false) {
    this.commands = new Map();
    this.groups = new Map();
    this.aliases = new Map(); // alias -> { command, group }
    this.debug = debug;
  }

  static async init(debug = false) {
    const registry = new CommandRegistry(debug);
    await registry.loadCommands();
    return registry;
  }

  async loadCommands() {
    const commandsDir = path.join(__dirname, '..', '..', 'commands');
    const entries = await fs.readdir(commandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('.disabled')) {
        await this.loadCommandsFromDirectory(path.join(commandsDir, entry.name), entry.name);
      }
    }

    if (this.debug) {
      this.log(`🔍 Auto-discovery completed: ${this.commands.size} commands found in ${this.groups.size} groups`);
      this.log(`🔗 Aliases registered: ${this.aliases.size}`, 'info');
    }
  }

  async loadCommandsFromDirectory(dirPath, groupName) {
    const files = await fs.readdir(dirPath);
    const commandFiles = files.filter(file => file.endsWith('Command.js') && !file.includes('Base'));
    if (!this.groups.has(groupName)) this.groups.set(groupName, []);
    for (const file of commandFiles) {
      await this.loadCommand(path.join(dirPath, file), groupName);
    }
  }

  async loadCommand(filePath, groupName) {
    const module = await import(pathToFileURL(filePath).href);
    let command = module.default;

    // If no default export, try to find a class export and instantiate it
    if (!command) {
      // Look for any exported class that ends with 'Command'
      const exports = Object.keys(module);
      const commandClass = exports.find(key => 
        key.endsWith('Command') && 
        typeof module[key] === 'function' && 
        module[key].prototype && 
        typeof module[key].prototype.execute === 'function'
      );
      
      if (commandClass) {
        const CommandClass = module[commandClass];
        command = new CommandClass();
        if (this.debug) {
          this.log(`🔧 Instantiated class: ${commandClass}`, 'info');
        }
      }
    }

    if (this.isValidCommand(command)) {
        command.group = groupName;

        // Registrar comando principal
        const commandKey = `${groupName}:${command.command}`;
        this.commands.set(commandKey, command);
        this.groups.get(groupName).push(command.command);

        // Registrar aliases
        if (command.aliases && typeof command.aliases === 'object') {
          Object.entries(command.aliases).forEach(([mainCommand, aliasesList]) => {
            if (mainCommand === command.command && Array.isArray(aliasesList)) {
              aliasesList.forEach(alias => {
                this.aliases.set(`${groupName}:${alias}`, {
                  command: command.command,
                  group: groupName
                });
                if (this.debug) {
                  this.log(`🔗 Alias registered: ${groupName} ${alias} -> ${command.command}`, 'info');
                }
              });
            }
          });
        }

        if (this.debug) {
          this.log(`📝 Registered: ${command.command} (${groupName})`, 'success');
        }
    }
  }

  isValidCommand(command) {
    return typeof command === 'object' && command !== null && typeof command.execute === 'function' && typeof command.getHelp === 'function';
  }

  // Nuevo método para resolver aliases
  resolveCommand(groupName, commandName) {
    const aliasKey = `${groupName}:${commandName}`;
    const commandKey = `${groupName}:${commandName}`;
    
    // Verificar si es un alias
    if (this.aliases.has(aliasKey)) {
      const aliasInfo = this.aliases.get(aliasKey);
      return {
        command: this.commands.get(`${aliasInfo.group}:${aliasInfo.command}`),
        actualCommandName: aliasInfo.command
      };
    }
    
    // Verificar si es un comando directo
    if (this.commands.has(commandKey)) {
      return {
        command: this.commands.get(commandKey),
        actualCommandName: commandName
      };
    }
    
    // Verificar si es un comando con parámetros posicionales (ej: "import <csvfile>")
    // Buscar por coincidencia parcial del nombre del comando
    for (const [key, command] of this.commands) {
      // Extraer la parte del comando sin parámetros posicionales
      const [group, commandPart] = key.split(':');
      if (group === groupName) {
        // Extraer solo el nombre del comando (la primera palabra después de los dos puntos)
        const baseCommandName = commandPart.split(' ')[0];
        if (baseCommandName === commandName) {
          return {
            command: command,
            actualCommandName: baseCommandName
          };
        }
      }
    }
    
    return null;
  }

  registerCommands(yargsInstance) {
  for (const [groupName, commands] of this.groups) {
    yargsInstance.command(groupName, false, (yargs) => {
      // Registrar comandos principales
      for (const commandName of commands) {
        const command = this.commands.get(`${groupName}:${commandName}`);
        
        // Construir la definición del comando con parámetros posicionales
        let commandDefinition = command.command;
        const config = command.constructor.config;
        if (config && config.positional && config.positional.length > 0) {
          const positionalParams = config.positional.map(param => `[${param}]`).join(' ');
          commandDefinition = `${command.command} ${positionalParams}`;
        }
        
        yargs.command(
          commandDefinition,
          command.description,
          (yargs) => {
            if (command.builder) {
              yargs.options(command.builder);
            }
            // IMPORTANTE: Configurar las opciones ANTES de retornar yargs
            const configuredYargs = command.configure(yargs);
            return configuredYargs;
          },
          async (argv) => {
            if (command.validate(argv)) {
              await command.execute(argv);
              // Cerrar el proceso si el comando no necesita mantenerlo vivo
              if (!command.keepAlive) {
                process.exit(0);
              }
            }
          }
        );

        // Registrar aliases como comandos separados en el mismo nivel
        for (const [aliasKey, aliasInfo] of this.aliases.entries()) {
          if (aliasInfo.group === groupName && aliasInfo.command === commandName) {
            const alias = aliasKey.split(':')[1];
            
            // Usar la misma definición con parámetros posicionales para aliases
            let aliasDefinition = alias;
            if (config && config.positional && config.positional.length > 0) {
              const positionalParams = config.positional.map(param => `[${param}]`).join(' ');
              aliasDefinition = `${alias} ${positionalParams}`;
            }
            
            yargs.command(
              aliasDefinition,
              `${command.description} (alias de ${command.command})`,
              (yargs) => {
                const configuredYargs = command.configure(yargs);
                return configuredYargs;
              },
              async (argv) => {
                if (command.validate(argv)) {
                  await command.execute(argv);
                  // Cerrar el proceso si el comando no necesita mantenerlo vivo
                  if (!command.keepAlive) {
                    process.exit(0);
                  }
                }
              }
            );
          }
        }
      }

      // Handler para comandos no encontrados o mostrar ayuda del grupo
      yargs.command({
        command: '*',
        handler: (argv) => {
          const commandName = argv._[1];
          
          // Detectar si se está pidiendo ayuda con --help
          const isHelpMode = process.argv.includes('--help') || process.argv.includes('-h');
          const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
          
          if (!commandName) {
            // Si no se especifica subcomando, mostrar comandos del grupo
            
            if (isHelpMode && isVerbose) {
              // Mostrar ayuda detallada del grupo
              this.showGroupHelp(groupName, true);
            } else if (isHelpMode) {
              // Mostrar ayuda básica del grupo
              this.showGroupHelp(groupName, false);
            } else {
              // Comportamiento original para cuando no hay --help
              const capitalizedGroupName = groupName.charAt(0).toUpperCase() + groupName.slice(1);
              
              tty.printBox(`📋 Comandos disponibles en el grupo \`${capitalizedGroupName}\``, 80);
              console.log();
              
              commands.forEach(cmd => {
                const command = this.commands.get(`${groupName}:${cmd}`);
                console.log(`  🔸 ${command.command.padEnd(25)} ${command.description}`);
                
                // Mostrar aliases si existen
                const commandAliases = [];
                for (const [aliasKey, aliasInfo] of this.aliases.entries()) {
                  if (aliasInfo.group === groupName && aliasInfo.command === cmd) {
                    const alias = aliasKey.split(':')[1];
                    commandAliases.push(alias);
                  }
                }
                if (commandAliases.length > 0) {
                  console.log(`     🔗 Aliases: ${commandAliases.join(', ')}`);
                }
                
                // Mostrar ejemplos de uso si existen
                if (command.examples && command.examples.length > 0) {
                  console.log(`     📌 Ejemplos de uso:`);
                  command.examples.forEach(example => {
                    console.log(`       ${example}`);
                  });
                  console.log(''); // Línea vacía después de cada comando
                }
              });
              
              console.log('');
              console.log(`💡 Usa "node com ${groupName} <comando> --help" para obtener ayuda específica de un comando.`);
              console.log('');
            }
          } else {
            console.error(`❌ Comando '${commandName}' no encontrado en el grupo '${groupName}'`);
            this.showGroupHelp(groupName);
          }
        }
      });
      
      return yargs.demandCommand(1, 'Debes especificar un subcomando');
    });
  }
  return yargsInstance;
}

  showHelp(group = null, command = null, verbose = false) {
    if (!group) {
      return this.showAllGroups();
    }

    if (group && !command) {
      return this.showGroupHelp(group, verbose);
    }

    // Resolver comando (puede ser alias)
    const resolved = this.resolveCommand(group, command);
    if (resolved) {
      // Para comandos con parámetros posicionales, usar la clave completa
      const fullKey = `${group}:${resolved.command.command}`;
      return this.showCommandHelp(fullKey);
    } else {
      console.error(`❌ Comando '${command}' no encontrado en el grupo '${group}'`);
      return this.showGroupHelp(group, verbose);
    }
  }

  showAllGroups() {
    console.log('');
    tty.printBox(`📋 Sistema de Comandos CLI`);
    console.log('');
    console.log('💡 Uso: node com <grupo> <comando> [argumentos]');
    console.log('');
    
    if (this.groups.size === 0) {
      console.log('⚠️ No se encontraron grupos de comandos.');
      return;
    }
    
    console.log('🗂️  Grupos de comandos disponibles:');
    console.log('');
    for (const [groupName] of this.groups) {
      const capitalizedName = groupName.charAt(0).toUpperCase() + groupName.slice(1);
      const commandCount = this.groups.get(groupName).length;
      console.log(`  🔹 ${capitalizedName.padEnd(15)} (${commandCount} comando${commandCount === 1 ? '' : 's'})`);
    }
    console.log('');
    console.log('💡 Ejemplos de uso:');
    console.log('   • node com stores list-stores');
    console.log('   • node com users show-user user@example.com');
    console.log('   • node com help stores    (ver comandos del grupo)');
    console.log('');
  }

  showGroupHelp(groupName, verbose = false) {
    if (!this.groups.has(groupName)) {
      console.error(`❌ Grupo '${groupName}' no encontrado`);
      this.showAllGroups();
      return;
    }
    
    console.log(`\n📋 Comandos del grupo '${groupName}':\n`);
    
    for (const commandName of this.groups.get(groupName)) {
      const command = this.commands.get(`${groupName}:${commandName}`);
      
      if (verbose) {
        // Mostrar información detallada
        console.log(`  ${command.command.padEnd(30)} ${command.description}\n`);
        
        const help = command.getHelp();
        
        // Mostrar argumentos requeridos
        if (help.config?.requiredArgs?.length) {
          console.log(`🔑 Argumentos requeridos:`);
          help.config.requiredArgs.forEach(arg => {
            const argDesc = help.config.options?.[arg]?.describe || '';
            console.log(`  --${arg}: ${argDesc}`);
          });
          console.log();
        }
        
        // Mostrar opciones disponibles
        if (help.config?.optionalArgs?.length || help.config?.options) {
          console.log(`⚙️ Opciones disponibles:`);
          Object.entries(help.config.options || {}).forEach(([key, opt]) => {
            if (!help.config?.requiredArgs?.includes(key)) {
              const defaultVal = opt.default !== undefined ? ` (default: ${opt.default})` : '';
              const desc = opt.describe || '';
              console.log(`  --${key}: ${desc}${defaultVal}`);
            }
          });
          console.log();
        }
        
        // Mostrar aliases
        const aliases = [];
        for (const [aliasKey, aliasInfo] of this.aliases.entries()) {
          if (aliasInfo.group === groupName && aliasInfo.command === commandName) {
            aliases.push(aliasKey.split(':')[1]);
          }
        }
        if (aliases.length > 0) {
          console.log(`🔗 Aliases: ${aliases.join(', ')}`);
          console.log();
        }
        
        // Mostrar ejemplos
        if (help.examples?.length) {
          console.log(`📌 Ejemplos de uso:`);
          help.examples.forEach(ex => console.log(`  ${ex}`));
          console.log();
        }
        
        console.log(''.padEnd(50, '-') + '\n');
        
      } else {
        // Mostrar información resumida (formato original)
        console.log(`  ${command.command.padEnd(30)} ${command.description}`);
        
        // Mostrar aliases
        const aliases = [];
        for (const [aliasKey, aliasInfo] of this.aliases.entries()) {
          if (aliasInfo.group === groupName && aliasInfo.command === commandName) {
            aliases.push(aliasKey.split(':')[1]);
          }
        }
        if (aliases.length > 0) {
          console.log(`  ${''.padEnd(30)} Aliases: ${aliases.join(', ')}`);
        }
      }
    }
    
    if (!verbose) {
      console.log('\n💡 Usa "node com <grupo> <comando> --help" para más detalles.');
      console.log('💡 Usa "node com <grupo> --help --verbose" para ver información detallada de todos los comandos.');
      console.log('💡 Usa "node com <grupo> --debug" para ver información de debugging del sistema.');
    }
  }

  showCommandHelp(commandKey) {
    const command = this.commands.get(commandKey);
    if (!command) {
      console.error(`❌ Comando no encontrado`);
      return;
    }

    const help = command.getHelp();

    console.log();
    tty.printBox(`📋 Ayuda para el comando: ${help.group} ${help.command}`);
    console.log();
    console.log(`Descripción: ${help.description}`);
    console.log(`Grupo: ${help.group}`);
    console.log();

    // Mostrar aliases
    const aliases = [];
    for (const [aliasKey, aliasInfo] of this.aliases.entries()) {
      if (aliasInfo.group === help.group && aliasInfo.command === help.command) {
        aliases.push(aliasKey.split(':')[1]);
      }
    }
    if (aliases.length > 0) {
      console.log(`Aliases: ${aliases.join(', ')}`);
    }

    if (help.config?.requiredArgs?.length) {
      console.log(`\n🔑 Argumentos requeridos:`);
      help.config.requiredArgs.forEach(arg => console.log(`  --${arg}`));
    }

    if (help.config?.optionalArgs?.length || help.config?.options) {
      console.log(`\n⚙️ Opciones disponibles:`);
      Object.entries(help.config.options || {}).forEach(([key, opt]) => {
        const defaultVal = opt.default !== undefined ? ` (default: ${opt.default})` : '';
        const desc = opt.describe || '';
        console.log(`  --${key}: ${desc}${defaultVal}`);
      });
    }

    if (help.examples?.length) {
      console.log(`\n📌 Ejemplos de uso:`);
      help.examples.forEach(ex => console.log(`  ${ex}`));
    }

    console.log('');
  }

  log(message, type = 'info') {
    const prefix = { info: 'ℹ️', success: '✅', error: '❌' };
    console.log(`${prefix[type]} ${message}`);
  }
}