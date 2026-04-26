// Test Supabase connection using Connection Pooler (recommended for external connections)
import { Client } from 'pg';
import EnvLoader from './core/libs/EnvLoader.js';

// Load environment variables first
EnvLoader.load();

// Extract connection parameters from environment
const projectRef = process.env.SUPABASE_PROJECT_REF || 'srcgnmyevaavcaazrorr';
const password = process.env.SUPABASE_PASSWORD || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_DB_PASSWORD;

// Connection Pooler configuration (recommended for external connections)
// Supabase provides different connection modes:
// - Transaction mode (port 6543) - recommended for serverless/short-lived connections
// - Session mode (port 5432) - for long-lived connections
const poolerConfig = {
  host: `aws-0-us-west-1.pooler.supabase.com`, // Connection pooler host
  port: 6543, // Transaction mode port
  database: 'postgres',
  user: `postgres.${projectRef}`,
  password: password,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 30000,
};

// Direct connection configuration (requires IPv4 add-on)
const directConfig = {
  host: `${projectRef}.supabase.co`,
  port: 5432,
  database: 'postgres',
  user: `postgres.${projectRef}`,
  password: password,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 30000,
};

async function testConnection(config, connectionType) {
  const client = new Client(config);

  try {
    console.log(`\n========== Testing ${connectionType} ==========`);
    console.log('Host:', config.host);
    console.log('Port:', config.port);
    console.log('User:', config.user);
    console.log('Password present:', !!config.password);

    console.log('\nAttempting to connect...');
    await client.connect();
    console.log('✅ Successfully connected!');

    // Try a simple query
    const result = await client.query('SELECT version();');
    console.log('✅ Query executed successfully');
    console.log('PostgreSQL version:', result.rows[0].version);

    // List tables
    const tablesResult = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(`\n✅ Found ${tablesResult.rows.length} tables in public schema:`);
    tablesResult.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.tablename}`);
    });

    return true;
  } catch (err) {
    console.error(`❌ Connection failed: ${err.message}`);
    console.error('Error code:', err.code);
    if (err.code === 'ETIMEDOUT') {
      console.error('\n💡 Timeout error - This usually means:');
      console.error('   1. The host/port is not accessible from your network');
      console.error('   2. Firewall is blocking the connection');
      console.error('   3. You need to enable IPv4 add-on in Supabase for direct connections');
    }
    return false;
  } finally {
    try {
      await client.end();
      console.log('Client disconnected.');
    } catch (e) {
      // Ignore disconnect errors
    }
  }
}

async function runTests() {
  console.log('🧪 Testing Supabase Connections');
  console.log('================================\n');

  // Test Connection Pooler first (recommended)
  const poolerSuccess = await testConnection(poolerConfig, 'Connection Pooler (Transaction Mode)');

  // Test Direct Connection
  const directSuccess = await testConnection(directConfig, 'Direct Connection');

  console.log('\n========== Summary ==========');
  console.log('Connection Pooler:', poolerSuccess ? '✅ SUCCESS' : '❌ FAILED');
  console.log('Direct Connection:', directSuccess ? '✅ SUCCESS' : '❌ FAILED');

  if (poolerSuccess || directSuccess) {
    console.log('\n✅ At least one connection method works!');
    if (poolerSuccess) {
      console.log('\n💡 Recommendation: Use Connection Pooler for better performance and reliability.');
      console.log('   Update your config to use:');
      console.log(`   - Host: aws-0-us-west-1.pooler.supabase.com`);
      console.log('   - Port: 6543');
    }
  } else {
    console.log('\n❌ Both connection methods failed.');
    console.log('\n💡 Troubleshooting steps:');
    console.log('1. Verify your SUPABASE_PASSWORD or SUPABASE_SERVICE_KEY in .env');
    console.log('2. Check if your project is active in Supabase dashboard');
    console.log('3. For direct connections, you may need to enable IPv4 add-on');
    console.log('4. Verify project ref:', projectRef);
  }
}

runTests();
