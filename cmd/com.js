import { runCLI } from './core/com.js';

// Ejecutar el CLI
runCLI().catch(error => {
  console.error('❌ Error fatal en el CLI:', error.message);
  process.exit(1);
});