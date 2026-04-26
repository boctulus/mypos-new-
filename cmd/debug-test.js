import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(['make', 'command', 'llm:test']))
  .positional('spec', {
    describe: 'Especificación del grupo y comandos en formato grupo:comando1,comando2',
    type: 'string'
  })
  .option('group', { type: 'string' })
  .option('new-group', { type: 'string' })
  .option('name', { type: 'string' })
  .argv;

console.log('Arguments received:');
console.log('spec:', argv.spec);
console.log('group:', argv.group);
console.log('new-group:', argv['new-group']);
console.log('name:', argv.name);