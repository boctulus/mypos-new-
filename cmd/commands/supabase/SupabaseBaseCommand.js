// CRITICAL: Load environment variables FIRST before any other imports
import EnvLoader from '../../core/libs/EnvLoader.js';
EnvLoader.load();

import { BaseCommand } from '../../core/libs/BaseCommand.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Base class for Supabase commands
 */
export class SupabaseBaseCommand extends BaseCommand {
  constructor() {
    super();
    this.group = 'supabase';
  }

  /**
   * Get Supabase Cloud connection config from environment
   */
  getSupabaseConfig() {
    return {
      host: process.env.SUPABASE_HOST,
      port: process.env.SUPABASE_PORT || '5432',
      database: process.env.SUPABASE_DATABASE || 'postgres',
      user: process.env.SUPABASE_USER,
      password: process.env.SUPABASE_PASSWORD,
      projectRef: process.env.SUPABASE_PROJECT_REF,
    };
  }

  /**
   * Get local Supabase Docker connection config from environment
   */
  getLocalSupabaseConfig() {
    return {
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || '54332',
      database: process.env.PGDATABASE || 'aggvaldb',
      user: process.env.PGUSER || 'supabase',
      password: process.env.PGPASSWORD || 'aggval_pass100',
    };
  }

  /**
   * Validate that Supabase environment variables are set
   */
  validateSupabaseConfig() {
    const config = this.getSupabaseConfig();

    if (!config.host) {
      throw new Error('SUPABASE_HOST not set in environment. Set it in .env.prod or pass --local for local Docker.');
    }
    if (!config.user) {
      throw new Error('SUPABASE_USER not set in environment');
    }
    if (!config.password) {
      throw new Error('SUPABASE_PASSWORD not set in environment');
    }

    return config;
  }

  /**
   * Execute psql command with Supabase connection
   */
  async executePsqlCommand(sql, config) {
    const command = `psql -h "${config.host}" -p ${config.port} -U "${config.user}" -d "${config.database}" -c "${sql.replace(/"/g, '\\"')}"`;

    try {
      const env = { ...process.env, PGPASSWORD: config.password };
      const { stdout, stderr } = await execAsync(command, {
        env,
        timeout: 30000 // 30s timeout for simple queries
      });
      return { stdout, stderr };
    } catch (error) {
      throw new Error(`PSQL execution failed: ${error.message}\n${error.stderr || ''}`);
    }
  }
}
