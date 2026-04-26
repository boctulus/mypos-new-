// Debug script to check database configuration
import EnvLoader from './core/libs/EnvLoader.js';
EnvLoader.load();

// Import config after loading env
const databasesConfig = (await import('./config/databases.config.js')).default;

console.log('\n========== DATABASE CONFIGURATION DEBUG ==========\n');

console.log('Environment Variables:');
console.log('─'.repeat(50));
console.log('SUPABASE_HOST:', process.env.SUPABASE_HOST);
console.log('SUPABASE_PORT:', process.env.SUPABASE_PORT);
console.log('SUPABASE_USER:', process.env.SUPABASE_USER);
console.log('SUPABASE_DATABASE:', process.env.SUPABASE_DATABASE);
console.log('SUPABASE_PASSWORD present:', !!process.env.SUPABASE_PASSWORD);
console.log('SUPABASE_DB_PASSWORD present:', !!process.env.SUPABASE_DB_PASSWORD);
console.log('SUPABASE_PROJECT_REF:', process.env.SUPABASE_PROJECT_REF);

console.log('\n');
console.log('Supabase Connection Config from databases.config.js:');
console.log('─'.repeat(50));
const supabaseConfig = databasesConfig.db_connections.supabase;
console.log('driver:', supabaseConfig.driver);
console.log('host:', supabaseConfig.host);
console.log('port:', supabaseConfig.port);
console.log('db_name:', supabaseConfig.db_name);
console.log('user:', supabaseConfig.user);
console.log('pass present:', !!supabaseConfig.pass);
console.log('pass length:', supabaseConfig.pass?.length || 0);
console.log('schema:', supabaseConfig.schema);
console.log('charset:', supabaseConfig.charset);

console.log('\n');
console.log('Client Options:');
console.log('─'.repeat(50));
console.log(JSON.stringify(supabaseConfig.client_options, null, 2));

console.log('\n');
console.log('Main Connection Config from databases.config.js:');
console.log('─'.repeat(50));
const mainConfig = databasesConfig.db_connections.main;
console.log('driver:', mainConfig.driver);
console.log('host:', mainConfig.host);
console.log('port:', mainConfig.port);
console.log('db_name:', mainConfig.db_name);
console.log('user:', mainConfig.user);
console.log('pass present:', !!mainConfig.pass);
console.log('schema:', mainConfig.schema);

console.log('\n');
console.log('Default Connection:', databasesConfig.db_connection_default);
console.log('\n');
