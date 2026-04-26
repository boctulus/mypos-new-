// Simple test to verify Supabase connection
import { Client } from 'pg';
import EnvLoader from './core/libs/EnvLoader.js';

// Load environment variables first
EnvLoader.load();

// Extract connection parameters from environment
// For Supabase, the user should typically be 'postgres' followed by a period and the project ID
const host = process.env.SUPABASE_HOST || 'srcgnmyevaavcaazrorr.supabase.co';
const port = process.env.SUPABASE_PORT || 5432;
const database = process.env.SUPABASE_DATABASE || 'postgres';
const user = process.env.SUPABASE_USER || 'postgres.srcgnmyevaavcaazrorr';
const password = process.env.SUPABASE_PASSWORD || process.env.SUPABASE_SERVICE_KEY;

console.log('Testing Supabase connection with parameters:');
console.log('- Host:', host);
console.log('- Port:', port);
console.log('- Database:', database);
console.log('- User:', user);
console.log('- Password present:', !!password);

// For Supabase, we need to use the correct SSL settings
const client = new Client({
  host,
  port: parseInt(port),
  database,
  user,
  password,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 30000, // Increase timeout
  idle_in_transaction_session_timeout: 30000,
});

async function testConnection() {
  try {
    console.log('\nAttempting to connect to Supabase...');
    await client.connect();
    console.log('✅ Successfully connected to Supabase!');
    
    // Try a simple query
    const result = await client.query('SELECT version();');
    console.log('✅ Query executed successfully:', result.rows[0]);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Error code:', err.code);
    console.error('Error detail:', err.detail);
  } finally {
    await client.end();
    console.log('Client disconnected.');
  }
}

testConnection();