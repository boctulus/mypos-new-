// Test direct pg.Pool connection with exact config
import pg from 'pg';
const { Pool } = pg;
import EnvLoader from './core/libs/EnvLoader.js';

EnvLoader.load();

const poolConfig = {
  host: process.env.SUPABASE_HOST || 'aws-1-us-east-1.pooler.supabase.com',
  port: parseInt(process.env.SUPABASE_PORT || '5432'),
  user: process.env.SUPABASE_USER || 'postgres.srcgnmyevaavcaazrorr',
  password: process.env.SUPABASE_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DATABASE || 'postgres',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
  max: 2,
  statement_timeout: 60000,
};

console.log('Testing direct pg.Pool connection');
console.log('─'.repeat(50));
console.log('Config:');
console.log('  host:', poolConfig.host);
console.log('  port:', poolConfig.port);
console.log('  user:', poolConfig.user);
console.log('  database:', poolConfig.database);
console.log('  password present:', !!poolConfig.password);
console.log('  password length:', poolConfig.password?.length || 0);
console.log('  ssl:', poolConfig.ssl);
console.log('');

const pool = new Pool(poolConfig);

async function testQuery() {
  let client;
  try {
    console.log('Acquiring client from pool...');
    client = await pool.connect();
    console.log('✅ Client acquired successfully!');

    console.log('\nExecuting test query...');
    const result = await client.query('SELECT version();');
    console.log('✅ Query executed successfully!');
    console.log('PostgreSQL version:', result.rows[0].version.substring(0, 50) + '...');

    console.log('\nListing tables...');
    const tables = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(`✅ Found ${tables.rows.length} tables:`);
    tables.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.tablename}`);
    });

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('Error code:', err.code);
    console.error('\nFull error:', err);
  } finally {
    if (client) {
      client.release();
      console.log('\nClient released back to pool.');
    }
    await pool.end();
    console.log('Pool closed.');
  }
}

testQuery();
