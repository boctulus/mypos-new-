#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Obtener el directorio actual del archivo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Sistema de comandos CLI modular y extensible
 *
 * IMPORTANTE: No hay mutaciones globales en el nivel superior del módulo
 * para evitar efectos secundarios al importar (Next.js safe)
 */


async function discoverCommands(commandsDir) {
  const commands = {};

  if (!fs.existsSync(commandsDir)) {
    console.error(`❌ Directorio de comandos no encontrado: ${commandsDir}`);
    return commands;
  }

  const groups = fs.readdirSync(commandsDir);

  if (global.verbose) {
    console.log(`📁 Directorios encontrados en ${commandsDir}:`, groups);
  }

  for (const group of groups) {
    const groupPath = path.join(commandsDir, group);

    // Ignorar directorios que empiezan con punto o terminan con .disabled
    if (group.startsWith('.') || group.endsWith('.disabled')) {
      if (global.verbose) {
        console.log(`⏭️  Ignorando grupo deshabilitado: ${group}`);
      }
      continue;
    }

    if (fs.statSync(groupPath).isDirectory()) {
      if (global.verbose) {
        console.log(`🔍 Escaneando grupo: ${group}`);
      }

      const groupCommands = fs.readdirSync(groupPath);
      if (global.verbose) {
        console.log(`📄 Archivos en grupo ${group}:`, groupCommands);
      }

      commands[group] = {};

      for (const commandFile of groupCommands) {
        if (commandFile.endsWith('Command.js') && !commandFile.includes('Base')) {
          const commandPath = path.join(groupPath, commandFile);
          const fileUrl = pathToFileURL(commandPath).href;
          try {
            if (global.verbose) {
              console.log(`📥 Intentando importar: ${commandPath}`);
            }

            const importedModule = await import(fileUrl);
            // Buscar la clase exportada (ya sea como default o con nombre)
            let CommandClass = importedModule.default;

            // Si no hay exportación por defecto, buscar la primera clase
            if (!CommandClass) {
              const exports = Object.keys(importedModule);
              for (const exp of exports) {
                if (typeof importedModule[exp] === 'function' &&
                    importedModule[exp].prototype &&
                    importedModule[exp].name &&
                    importedModule[exp].name.endsWith('Command')) {
                  CommandClass = importedModule[exp];
                  break;
                }
              }
            }

            if (CommandClass && typeof CommandClass === 'function') {
              const commandInstance = new CommandClass();

              // Extraer el nombre del comando del nombre del archivo
              let commandName = commandFile.replace('Command.js', '').toLowerCase();
              if (commandName === 'command') {
                // Para el caso especial de archivos como CommandCommand.js
                commandName = path.basename(groupPath).toLowerCase();
              }

              // Si el nombre del comando es vacío, usar el nombre del archivo
              if (!commandName) {
                commandName = path.basename(commandFile, '.js').replace('Command', '').toLowerCase();
              }

              // Si el comando tiene un nombre definido en la instancia, usarlo
              if (commandInstance.command) {
                commandName = commandInstance.command;
              }

              commands[group][commandName] = {
                CommandClass,
                instance: commandInstance,
                filePath: commandPath
              };

              if (global.verbose) {
                console.log(`✅ Registrado comando: ${group}:${commandName} (${commandInstance.description || 'Sin descripción'})`);
              }

              // Register aliases
              if (commandInstance.aliases) {
                Object.entries(commandInstance.aliases).forEach(([originalCmd, aliasList]) => {
                  // Only register aliases for this command if commandName matches
                  if (originalCmd === commandName && Array.isArray(aliasList)) {
                    aliasList.forEach(alias => {
                      commands[group][alias] = {
                        CommandClass,
                        instance: commandInstance,
                        filePath: commandPath,
                        isAlias: true,
                        aliasedCommand: commandName
                      };
                      if (global.verbose) {
                        console.log(`🔗 Registrado alias: ${group}:${alias} -> ${commandName}`);
                      }
                    });
                  }
                });
              }
            } else {
              if (global.verbose) {
                console.log(`⚠️  No se pudo crear instancia de comando: ${commandFile}`);
              }
            }
          } catch (error) {
            console.error(`❌ Error al cargar comando ${group}:${commandFile}:`, error.message);
            if (global.verbose) {
              console.error(error.stack);
            }
          }
        } else {
          if (global.verbose) {
            console.log(`⏭️  Ignorando archivo no comando: ${commandFile}`);
          }
        }
      }
    }
  }

  if (global.verbose) {
    console.log(`📋 Resumen de comandos registrados:`, Object.keys(commands).reduce((acc, group) => {
      acc[group] = Object.keys(commands[group]);
      return acc;
    }, {}));
  }

  return commands;
}

function showHelp(commands, group = null, command = null) {
  if (command && group && commands[group] && commands[group][command]) {
    // Mostrar ayuda específica para un comando
    const cmd = commands[group][command];
    console.log(`\n📚 Ayuda para: ${group}:${command}\n`);
    console.log(`Descripción: ${cmd.instance.description || 'Sin descripción'}`);

    if (cmd.instance.examples && cmd.instance.examples.length > 0) {
      console.log('\n💡 Ejemplos:');
      cmd.instance.examples.forEach(example => console.log(`  ${example}`));
    }

    const config = cmd.CommandClass.config || {};
    if (config.options) {
      console.log('\n⚙️  Opciones disponibles:');
      Object.entries(config.options).forEach(([opt, optConfig]) => {
        const required = config.requiredArgs && config.requiredArgs.includes(opt) ? ' (requerido)' : '';
        console.log(`  --${opt}${required}: ${optConfig.describe} (tipo: ${optConfig.type || 'string'})`);
      });
    }
  } else if (group && commands[group]) {
    // Mostrar ayuda para un grupo específico
    console.log(`\n📂 Comandos disponibles en el grupo: ${group}\n`);
    
    // Group commands by their base command (exclude aliases from main list but show them)
    const baseCommands = {};
    const aliasMap = {};
    
    Object.entries(commands[group]).forEach(([cmdName, cmd]) => {
      if (cmd.isAlias) {
        const baseCmd = cmd.aliasedCommand;
        if (!aliasMap[baseCmd]) aliasMap[baseCmd] = [];
        aliasMap[baseCmd].push(cmdName);
      } else {
        baseCommands[cmdName] = cmd;
      }
    });
    
    Object.entries(baseCommands).forEach(([cmdName, cmd]) => {
      const aliases = aliasMap[cmdName] || [];
      const aliasText = aliases.length > 0 ? ` [alias: ${aliases.join(', ')}]` : '';
      console.log(`  ${cmdName}${aliasText}: ${cmd.instance.description || 'Sin descripción'}`);
    });
  } else {
    // Mostrar ayuda general
    console.log('\n🎯 Sistema de Comandos CLI\n');
    console.log('Uso: node com <grupo> <comando> [argumentos] [opciones]\n');

    console.log('Grupos disponibles:');
    Object.keys(commands).forEach(group => {
      console.log(`  📁 ${group}:`);
      
      // Group commands by their base command
      const baseCommands = {};
      const aliasMap = {};
      
      Object.entries(commands[group]).forEach(([cmdName, cmd]) => {
        if (cmd.isAlias) {
          const baseCmd = cmd.aliasedCommand;
          if (!aliasMap[baseCmd]) aliasMap[baseCmd] = [];
          aliasMap[baseCmd].push(cmdName);
        } else {
          baseCommands[cmdName] = cmd;
        }
      });
      
      Object.entries(baseCommands).forEach(([cmdName, cmd]) => {
        const aliases = aliasMap[cmdName] || [];
        const aliasText = aliases.length > 0 ? ` [alias: ${aliases.join(', ')}]` : '';
        console.log(`    - ${cmdName}${aliasText}: ${cmd.instance.description || 'Sin descripción'}`);
      });
    });

    console.log('\nOpciones especiales:');
    console.log('  --verbose: Habilita el modo detallado para debugging');
    console.log('  --help: Muestra esta ayuda o la ayuda específica de un comando');
    console.log('\nEjemplos:');
    console.log('  node com help                    # Esta ayuda general');
    console.log('  node com help <grupo>           # Ayuda de un grupo específico');
    console.log('  node com help <grupo> <comando> # Ayuda específica de un comando');
    console.log('  node com <grupo> <comando>      # Ejecutar un comando');
  }
}


export async function runCLI() {
  // Inicializar global.verbose solo cuando el CLI se ejecuta
  // (no al importar el módulo)
  if (global.verbose === undefined) {
    global.verbose = false;
  }

  const args = process.argv.slice(2);

  // Preprocesar argumentos para detectar --verbose temprano
  if (args.includes('--verbose')) {
    global.verbose = true;
    console.log('🔧 Modo verbose activado');
  }

  if (global.verbose) {
    console.log('ARGV:', args);
  }

  // Detectar comandos de ayuda
  if ((args[0] === 'help' || args.includes('--help')) && args[0] !== '--verbose') {
    const commands = await discoverCommands(path.join(__dirname, '..', 'commands'));

    // Determinar los argumentos para mostrar la ayuda
    let helpGroup = null;
    let helpCommand = null;

    if (args[0] === 'help' && args.length > 1) {
      helpGroup = args[1];
      if (args.length > 2) {
        helpCommand = args[2];
      }
    } else if (args.includes('--help') && args.length > 1) {
      // Si --help está en otra posición, buscar el grupo y comando
      const helpIndex = args.indexOf('--help');
      if (helpIndex > 0 && args[helpIndex - 1] !== '--verbose') {
        // Buscar grupo y comando antes de --help
        for (let i = 0; i < helpIndex; i++) {
          if (args[i] !== '--verbose') {
            if (!helpGroup) helpGroup = args[i];
            else if (!helpCommand) helpCommand = args[i];
          }
        }
      }
    }

    if (helpGroup) {
      if (helpCommand) {
        showHelp(commands, helpGroup, helpCommand);
      } else {
        showHelp(commands, helpGroup);
      }
    } else {
      showHelp(commands);
    }
    return;
  }

  // Procesar comando normal
  if (args.length < 2) {
    const commands = await discoverCommands(path.join(__dirname, '..', 'commands'));
    showHelp(commands);
    return;
  }

  const [group, command, ...rest] = args;

  if (global.verbose) {
    console.log(`🔍 Buscando comando: ${group}:${command}`);
  }

  const commands = await discoverCommands(path.join(__dirname, '..', 'commands'));

  if (!commands[group]) {
    console.error(`❌ Grupo de comandos no encontrado: ${group}`);
    showHelp(commands);
    return;
  }

  if (!commands[group][command]) {
    // Handle "help" as a special command to show group help
    if (command === 'help') {
      showHelp(commands, group);
      return;
    }

    console.error(`❌ Comando no encontrado: ${group}:${command}`);

    // Mostrar comandos disponibles en el grupo (con aliases agrupados)
    console.log(`\nComandos disponibles en el grupo '${group}':`);
    
    const baseCommands = {};
    const aliasMap = {};
    
    Object.entries(commands[group]).forEach(([cmdName, cmd]) => {
      if (cmd.isAlias) {
        const baseCmd = cmd.aliasedCommand;
        if (!aliasMap[baseCmd]) aliasMap[baseCmd] = [];
        aliasMap[baseCmd].push(cmdName);
      } else {
        baseCommands[cmdName] = cmd;
      }
    });
    
    Object.entries(baseCommands).forEach(([cmdName, cmd]) => {
      const aliases = aliasMap[cmdName] || [];
      const aliasText = aliases.length > 0 ? ` [alias: ${aliases.join(', ')}]` : '';
      console.log(`  - ${cmdName}${aliasText}: ${cmd.instance.description || 'Sin descripción'}`);
    });

    return;
  }

  // Parsear argumentos restantes
  const argv = { _: [] };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];

    if (arg.startsWith('--')) {
      // Opciones largas: --key=value o --key value
      const equalPos = arg.indexOf('=');

      if (equalPos > -1) {
        // Formato: --key=value
        const key = arg.substring(2, equalPos);
        const value = arg.substring(equalPos + 1);
        argv[key] = value;
      } else {
        // Formato: --key o --key value
        const key = arg.substring(2);

        // Verificar si el siguiente argumento es un valor (no empieza con -)
        if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
          argv[key] = rest[i + 1];
          i++; // Saltar el siguiente argumento
        } else {
          // Es un flag booleano
          argv[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Opciones cortas: -k
      const key = arg.substring(1);
      argv[key] = true;
    } else {
      // Argumento posicional
      argv._.push(arg);
    }
  }

  if (global.verbose) {
    console.log('Parsed arguments:', argv);
  }

  try {
    const cmd = commands[group][command];

    // Validar argumentos antes de ejecutar
    if (cmd.instance.validate) {
      try {
        if (!cmd.instance.validate(argv)) {
          return; // Validation printed its own error, exit silently
        }
      } catch (validationError) {
        if (validationError.silent) {
          return; // Validation already printed error message
        }
        throw validationError;
      }
    }

    const result = await cmd.instance.execute(argv);

    if (result !== undefined) {
      console.log('Resultado:', result);
    }
  } catch (error) {
    console.error(`❌ Error ejecutando comando ${group}:${command}:`, error.message);
    if (global.verbose) {
      console.error(error.stack);
    }
    throw error;
  }
}

// La función runCLI() se exporta para ser llamada desde bin/com.js
// NO se ejecuta automáticamente para evitar corrupción del runtime de Next.js