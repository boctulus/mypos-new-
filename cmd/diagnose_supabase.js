// Diagnostic script to find the correct Supabase connection configuration
import { Client } from 'pg';
import EnvLoader from './core/libs/EnvLoader.js';

// Load environment variables
EnvLoader.load();

const projectRef = process.env.SUPABASE_PROJECT_REF || 'srcgnmyevaavcaazrorr';
const password = process.env.SUPABASE_PASSWORD || process.env.SUPABASE_DB_PASSWORD;

// Common Supabase pooler configurations by region
const poolerConfigs = [
  // AWS Regions
  { name: 'AWS US West 1 (Oregon) - Transaction', host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS US West 1 (Oregon) - Session', host: 'aws-0-us-west-1.pooler.supabase.com', port: 5432 },
  { name: 'AWS US East 1 (Virginia) - Transaction', host: 'aws-0-us-east-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS US East 1 (Virginia) - Session', host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432 },
  { name: 'AWS EU West 1 (Ireland) - Transaction', host: 'aws-0-eu-west-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS EU West 1 (Ireland) - Session', host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432 },
  { name: 'AWS AP Southeast 1 (Singapore) - Transaction', host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS AP Southeast 1 (Singapore) - Session', host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432 },
  { name: 'AWS EU Central 1 (Frankfurt) - Transaction', host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS EU Central 1 (Frankfurt) - Session', host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432 },
  { name: 'AWS SA East 1 (São Paulo) - Transaction', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 6543 },
  { name: 'AWS SA East 1 (São Paulo) - Session', host: 'aws-0-sa-east-1.pooler.supabase.com', port: 5432 },
];

async function testConnection(config) {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: password,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000, // Shorter timeout for faster testing
  });

  try {
    await client.connect();

    // Try a simple query
    const result = await client.query('SELECT version();');

    // Get table count
    const tables = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    await client.end();

    return {
      success: true,
      version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1],
      tableCount: tables.rows[0].count
    };
  } catch (err) {
    try {
      await client.end();
    } catch (e) {
      // Ignore
    }

    return {
      success: false,
      error: err.message,
      code: err.code
    };
  }
}

async function runDiagnostics() {
  console.log('🔍 Supabase Connection Diagnostics');
  console.log('===================================\n');
  console.log('Project Ref:', projectRef);
  console.log('Password present:', !!password, '\n');

  if (!password) {
    console.error('❌ ERROR: No password found in .env');
    console.error('   Please set SUPABASE_PASSWORD or SUPABASE_DB_PASSWORD\n');
    return;
  }

  console.log('Testing different pooler configurations...\n');

  let successCount = 0;
  let workingConfig = null;

  for (const config of poolerConfigs) {
    process.stdout.write(`Testing ${config.name.padEnd(50)}... `);

    const result = await testConnection(config);

    if (result.success) {
      console.log(`✅ SUCCESS (${result.tableCount} tables)`);
      successCount++;
      if (!workingConfig) {
        workingConfig = { ...config, ...result };
      }
    } else {
      const errorMsg = result.code === 'ETIMEDOUT' ? 'TIMEOUT' :
                      result.code === 'XX000' ? 'WRONG REGION' :
                      result.code;
      console.log(`❌ ${errorMsg}`);
    }
  }

  console.log('\n===================================');
  console.log(`Results: ${successCount}/${poolerConfigs.length} succeeded\n`);

  if (workingConfig) {
    console.log('✅ WORKING CONFIGURATION FOUND!\n');
    console.log('Add these to your .env file:');
    console.log('─'.repeat(50));
    console.log(`SUPABASE_HOST=${workingConfig.host}`);
    console.log(`SUPABASE_PORT=${workingConfig.port}`);
    console.log('─'.repeat(50));
    console.log('\nOr update config/databases.config.js:');
    console.log('─'.repeat(50));
    console.log(`host: '${workingConfig.host}',`);
    console.log(`port: ${workingConfig.port},`);
    console.log('─'.repeat(50));
    console.log(`\nDatabase info: ${workingConfig.version}`);
    console.log(`Tables found: ${workingConfig.tableCount}`);
  } else {
    console.log('❌ NO WORKING CONFIGURATION FOUND\n');
    console.log('Possible issues:');
    console.log('1. Wrong password - verify SUPABASE_PASSWORD in .env');
    console.log('2. Wrong project ref - verify SUPABASE_PROJECT_REF');
    console.log('3. Project paused - check Supabase dashboard');
    console.log('4. Network/firewall blocking connections');
    console.log('\nTo get the correct configuration:');
    console.log('1. Go to Supabase Dashboard → Project Settings → Database');
    console.log('2. Look for "Connection string" → "Connection pooling"');
    console.log('3. Copy the host and port from there');
  }
}

runDiagnostics().catch(console.error);
