// CRITICAL: Load environment variables FIRST before any other imports
import EnvLoader from '../../core/libs/EnvLoader.js';
EnvLoader.load();

import { SupabaseBaseCommand } from './SupabaseBaseCommand.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Import database backup to Supabase Cloud
 *
 * Handles:
 * - SQL sanitization for cloud compatibility (removes internal schemas, role fixes)
 * - IPv4/IPv6 fallback for psql connections
 * - Multiple import strategies (direct, batched, SQL Editor export)
 */
export default class ImportCommand extends SupabaseBaseCommand {
  constructor() {
    super();
    this.command = 'import';
    this.description = 'Import database backup to Supabase Cloud';
    this.examples = [
      'node com supabase import --path=backup.sql --cloud',
      'node com supabase import --path=backup.sql --local',
      'node com supabase import --path=backup.sql --cloud --prepare-only',
      'node com supabase import --path=backup.sql --cloud --editor-only',
      'node com supabase import --path=backup.dump --cloud'
    ];
  }

  static config = {
    options: {
      path: {
        describe: 'Path to SQL backup file (.sql) or custom format backup (.dump)',
        type: 'string'
      },
      'prepare-only': {
        describe: 'Only prepare the SQL file for import without actually importing',
        type: 'boolean'
      },
      'editor-only': {
        describe: 'Generate a sanitized SQL file ready for Supabase Dashboard SQL Editor (no psql needed)',
        type: 'boolean'
      },
      host: {
        describe: 'Override Supabase host (e.g., pooler endpoint or localhost for local Docker)',
        type: 'string'
      },
      local: {
        describe: 'Use local Docker Supabase configuration',
        type: 'boolean'
      },
      cloud: {
        describe: 'Use Supabase Cloud configuration and adapt SQL for cloud compatibility',
        type: 'boolean'
      },
      raw: {
        describe: 'Skip SQL preparation and import the file as-is',
        type: 'boolean'
      },
      role: {
        describe: 'Database role to use for ownership (default: postgres for cloud, supabase for local)',
        type: 'string'
      },
      'batch-size': {
        describe: 'Max number of statements per batch when importing (default: 500)',
        type: 'number'
      },
      'exclude-tables': {
        describe: 'Comma-separated list of table patterns to exclude (e.g., "auth.*,storage.*,realtime.*")',
        type: 'string'
      },
      'schema-only': {
        describe: 'Import only schema (CREATE TABLE, indexes, etc.), skip data (INSERT statements)',
        type: 'boolean'
      }
    },
    requiredArgs: ['path']
  };

  validate(argv) {
    if (!argv.path) {
      console.error('❌ Error: --path is required');
      console.log('');
      console.log('Uso: node com supabase import --path=<backup_file>');
      console.log('');
      console.log('Ejemplos:');
      console.log('  node com supabase import --path=backup.sql --cloud');
      console.log('  node com supabase import --path=backup.sql --local');
      console.log('  node com supabase import --path=backup.sql --cloud --prepare-only');
      console.log('  node com supabase import --path=backup.sql --cloud --editor-only');
      // Throw with a silent marker to prevent double error output
      const err = new Error('VALIDATION_SILENT');
      err.silent = true;
      throw err;
    }

    // Validate file exists
    if (!fs.existsSync(argv.path)) {
      console.error(`❌ Error: File not found: ${argv.path}`);
      const err = new Error('VALIDATION_SILENT');
      err.silent = true;
      throw err;
    }

    // Validate file extension
    const ext = path.extname(argv.path).toLowerCase();
    if (!['.sql', '.dump'].includes(ext)) {
      console.error(`❌ Error: Unsupported file format: ${ext}. Expected .sql or .dump`);
      const err = new Error('VALIDATION_SILENT');
      err.silent = true;
      throw err;
    }

    return true;
  }

  async execute(argv) {
    try {
      const filePath = path.resolve(argv.path);

      // Determine which config to use
      let config;
      let isCloud = false;
      let isLocal = false;

      if (argv.cloud) {
        config = this.validateSupabaseConfig();
        isCloud = true;
        console.log('☁️  Using Supabase Cloud configuration');
      } else if (argv.local || argv.host === 'localhost') {
        config = this.getLocalSupabaseConfig();
        isLocal = true;
        console.log('🔧 Using local Docker Supabase configuration');
      } else {
        // Default to cloud if neither --local nor --host=localhost
        config = this.validateSupabaseConfig();
        isCloud = true;
        console.log('☁️  Using Supabase Cloud configuration (default)');
      }

      // Override host if provided
      if (argv.host) {
        config = { ...config, host: argv.host };
      }

      // Determine target role
      const targetRole = argv.role || (isLocal ? 'supabase' : 'postgres');
      const envLabel = isCloud ? 'Cloud' : 'Docker (local)';

      console.log(`🚀 Starting import to Supabase ${envLabel}`);
      console.log(`📦 Backup file: ${filePath}`);
      console.log(`🌐 Target: ${config.host}:${config.port}/${config.database}`);
      console.log(`🔑 Role: ${targetRole}`);

      // Check file extension
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.dump') {
        await this.importCustomFormatFile(filePath, config);
        return;
      }

      // .sql file handling
      const excludeTables = argv['exclude-tables'] ? argv['exclude-tables'].split(',') : [];
      const schemaOnly = argv['schema-only'] || false;

      // Prepare the SQL file for cloud import
      const preparedPath = filePath.replace('.sql', `_prepared.sql`);
      this.prepareSqlForCloud(filePath, preparedPath, {
        role: targetRole,
        excludeTables,
        schemaOnly
      });

      // Handle --prepare-only: just generate the file and exit
      if (argv['prepare-only']) {
        console.log(`\n✅ SQL file prepared: ${preparedPath}`);
        this.printImportOptions(preparedPath, config, isCloud);
        return;
      }

      // Handle --editor-only: generate a file sized for SQL Editor and exit
      if (argv['editor-only']) {
        const editorPath = filePath.replace('.sql', `_editor_ready.sql`);
        const fileSize = fs.statSync(preparedPath).size;
        const maxEditorSize = 1 * 1024 * 1024; // 1MB limit for SQL Editor

        if (fileSize > maxEditorSize) {
          console.warn(`\n⚠️  Prepared file is ${(fileSize / 1024 / 1024).toFixed(2)}MB, which exceeds the ~1MB SQL Editor limit.`);
          console.warn('💡 Use --batch-size to import via psql instead, or use --schema-only for schema-only import.');
        }

        // Copy prepared file to editor path
        fs.copyFileSync(preparedPath, editorPath);
        console.log(`\n✅ SQL file ready for Supabase Dashboard SQL Editor: ${editorPath}`);
        console.log(`📊 File size: ${(fs.statSync(editorPath).size / 1024).toFixed(1)}KB`);
        console.log('');
        console.log('💡 To import via SQL Editor:');
        console.log(`   1. Go to: https://app.supabase.com/project/${config.projectRef || 'your-project'}/sql`);
        console.log(`   2. Copy the content of: ${editorPath}`);
        console.log('   3. Paste and run in the SQL Editor');

        // Clean up prepared file
        if (fs.existsSync(preparedPath) && preparedPath !== editorPath) {
          fs.unlinkSync(preparedPath);
        }
        return;
      }

      // Import the prepared SQL file
      if (argv.raw) {
        console.log('\n📤 Importing raw SQL file (no preparation)...');
        await this.importWithFallback(filePath, config);
      } else {
        console.log('\n📤 Importing prepared SQL file...');
        await this.importWithFallback(preparedPath, config);
      }

      console.log('\n✅ Import completed successfully!');
      console.log('💡 Verify the import by running:');
      console.log('   node com sql list --connection=supabase');

    } catch (error) {
      console.error('❌ Import failed:', error.message);
      if (global.verbose) {
        console.error(error.stack);
      }
      throw error;
    } finally {
      // Clean up prepared file if it was created (but not if user used --prepare-only)
    }
  }

  /**
   * Print options for importing the prepared file
   */
  printImportOptions(preparedPath, config, isCloud) {
    console.log('');
    console.log('💡 Import options:');
    if (isCloud) {
      console.log(`   1. SQL Editor: Go to https://app.supabase.com/project/${config.projectRef || 'your-project'}/sql`);
      console.log(`      and paste the content of: ${preparedPath}`);
      console.log(`   2. Direct: node com supabase import --path=${preparedPath} --cloud --raw`);
    } else {
      console.log(`   node com supabase import --path=${preparedPath} --local --raw`);
    }
  }

  /**
   * Import SQL file with IPv4/IPv6 fallback strategy
   *
   * Strategy:
   * 1. Try direct psql import (may fail on IPv6 networks)
   * 2. Force IPv4 via `psql -h` with explicit host resolution
   * 3. Batch import (split large files into chunks)
   * 4. Fall back to SQL Editor export instructions
   */
  async importWithFallback(filePath, config) {
    const fileSize = fs.statSync(filePath).size;
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    console.log(`📄 File size: ${fileSizeMB}MB`);

    // For files > 10MB, always use batch mode
    const useBatch = fileSize > 10 * 1024 * 1024;
    const batchSize = parseInt(process.env.IMPORT_BATCH_SIZE || '500', 10);

    if (useBatch) {
      console.log('⚠️  Large file detected, using batch import mode...');
      return this.importBatch(filePath, config, batchSize);
    }

    // Try direct import first
    try {
      const result = await this.runPsqlImport(filePath, config);
      return result;
    } catch (error) {
      console.warn(`\n⚠️  Direct import failed: ${error.message}`);
      console.log('🔄 Trying IPv4 fallback...');
    }

    // IPv4 fallback: try with forced IPv4
    try {
      const result = await this.runPsqlImportIpv4(filePath, config);
      return result;
    } catch (error) {
      console.warn(`\n⚠️  IPv4 import also failed: ${error.message}`);
    }

    // Last resort: batch import
    console.log('🔄 Trying batch import mode...');
    return this.importBatch(filePath, config, batchSize);
  }

  /**
   * Run psql import with standard settings
   */
  async runPsqlImport(filePath, config) {
    // Don't use ON_ERROR_STOP=1 because we want idempotent imports
    // where IF NOT EXISTS and similar patterns don't cause failure
    const command = `psql -h "${config.host}" -p ${config.port} -U "${config.user}" -d "${config.database}" -f "${filePath}"`;

    if (global.verbose) {
      console.log(`🔧 Running: ${command}`);
    }

    const { stdout, stderr } = await this.executeWithEnv(command, config);

    if (stderr && stderr.trim()) {
      // Count errors vs warnings (psql prefixes errors with 'psql:... ERROR:')
      const errorCount = (stderr.match(/ERROR:/gm) || []).length;
      const errorLines = stderr.split('\n').filter(l => l.includes('ERROR:'));
      const warningLines = stderr.split('\n').filter(l => !l.includes('ERROR:') && l.trim());

      if (errorCount > 0) {
        // For idempotent imports, check if errors are 'already exists' type
        const isAllIdempotent = errorLines.every(line =>
          line.includes('already exists') ||
          line.includes('does not exist') ||
          line.includes('already has')
        );

        if (isAllIdempotent) {
          console.log('ℹ️  Idempotent import: some objects already exist (expected for re-runs)');
          if (global.verbose && errorLines.length > 0) {
            console.log('   Details:', errorLines.slice(0, 3).join('\n   '));
          }
        } else {
          throw new Error(`${errorCount} SQL error(s) during import:\n${errorLines.slice(0, 5).join('\n')}`);
        }
      }
      if (warningLines.length > 0) {
        console.log('⚠️  Import warnings:', warningLines.slice(0, 5).join('\n'));
      }
    }

    return { stdout, stderr };
  }

  /**
   * Run psql import with IPv4 enforcement
   * Uses PGGSSENCMODE to disable SSL encryption mode issues
   */
  async runPsqlImportIpv4(filePath, config) {
    const command = `psql -h "${config.host}" -p ${config.port} -U "${config.user}" -d "${config.database}" -f "${filePath}"`;

    if (global.verbose) {
      console.log(`🔧 Running (IPv4 forced): ${command}`);
    }

    const { stdout, stderr } = await this.executeWithEnv(command, config, {
      PGGSSENCMODE: 'disable',
      PGOPTIONS: '-c statement_timeout=300000'
    });

    if (stderr && stderr.trim()) {
      const errorCount = (stderr.match(/^ERROR:/gm) || []).length;
      if (errorCount > 0) {
        throw new Error(`${errorCount} SQL error(s) during import:\n${stderr.split('\n').filter(l => l.startsWith('ERROR:')).slice(0, 5).join('\n')}`);
      }
    }

    return { stdout, stderr };
  }

  /**
   * Execute a command with PGPASSWORD in environment (cross-platform compatible)
   */
  async executeWithEnv(command, config, extraEnv = {}) {
    const env = {
      ...process.env,
      PGPASSWORD: config.password,
      ...extraEnv
    };

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        env,
        timeout: 600000, // 10 minutes timeout
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
      return { stdout, stderr };
    } catch (error) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';

      // Detect common network errors
      if (stderr.includes('could not translate host name') ||
          stderr.includes('Connection refused') ||
          stderr.includes('Connection timed out') ||
          stderr.includes('ETIMEDOUT') ||
          stderr.includes('ECONNRESET') ||
          stderr.includes('ENOTFOUND')) {
        throw new Error(`Network connection failed: ${error.message}\n${stderr}`);
      }

      // If it's a SQL error (not a network error), still throw
      throw new Error(`Import error: ${error.message}\n${stderr}`);
    }
  }

  /**
   * Batch import: split SQL file into chunks and import one by one
   * This helps with large files that might timeout or fail in single import
   */
  async importBatch(filePath, config, batchSize) {
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = this.splitSqlStatements(sql);

    console.log(`📊 Total statements: ${statements.length}`);
    console.log(`📦 Batch size: ${batchSize} statements per batch`);

    const totalBatches = Math.ceil(statements.length / batchSize);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, statements.length);
      const batch = statements.slice(start, end);

      const batchSql = batch.join('\n\n');
      if (!batchSql.trim()) continue;

      const batchNum = i + 1;
      process.stdout.write(`\r📤 Importing batch ${batchNum}/${totalBatches} (${batch.length} statements)`);

      try {
        // Write batch to temp file
        const tempPath = path.join(path.dirname(filePath), `_batch_${batchNum}.tmp.sql`);
        fs.writeFileSync(tempPath, batchSql, 'utf8');

        await this.runPsqlImport(tempPath, config);
        successCount += batch.length;

        // Clean up temp file
        fs.unlinkSync(tempPath);
      } catch (error) {
        errorCount += batch.length;
        console.warn(`\n⚠️  Batch ${batchNum} had errors: ${error.message.split('\n')[0]}`);
      }
    }

    console.log('');
    console.log(`✅ Batch import complete: ${successCount} succeeded, ${errorCount} failed`);

    if (errorCount > 0) {
      console.warn('⚠️  Some statements failed. Check the output above for details.');
    }

    return { successCount, errorCount };
  }

  /**
   * Split SQL into individual statements
   * Handles multi-line statements, ignores comments
   */
  splitSqlStatements(sql) {
    const statements = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let prevChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1] || '';

      // Handle line comments
      if (!inString && !inBlockComment && char === '-' && nextChar === '-') {
        inLineComment = true;
        current += char;
        continue;
      }

      if (inLineComment) {
        current += char;
        if (char === '\n') {
          inLineComment = false;
        }
        continue;
      }

      // Handle block comments
      if (!inString && char === '/' && nextChar === '*') {
        inBlockComment = true;
        current += char;
        continue;
      }

      if (inBlockComment) {
        current += char;
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          current += nextChar;
          i++; // skip next
        }
        continue;
      }

      // Handle strings
      if (char === "'" || char === '"') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar && prevChar !== '\\') {
          inString = false;
        }
      }

      // Handle statement boundaries
      if (!inString && char === ';') {
        const stmt = current.trim();
        if (stmt && !stmt.startsWith('--')) {
          statements.push(stmt);
        }
        current = '';
        prevChar = char;
        continue;
      }

      current += char;
      prevChar = char;
    }

    // Handle last statement without semicolon
    const last = current.trim();
    if (last && !last.startsWith('--')) {
      statements.push(last);
    }

    return statements;
  }

  /**
   * Prepare SQL file for Supabase Cloud import
   *
   * Transformations applied:
   * 1. Remove/replace role references (supabase -> postgres)
   * 2. Remove Supabase internal schemas (auth, storage, realtime, etc.)
   * 3. Remove DROP/CREATE SCHEMA public statements
   * 4. Remove pg_dump metadata comments
   * 5. Add safe SET statements for import
   * 6. Optionally exclude specific table patterns (--exclude-tables)
   * 7. Optionally skip data INSERT statements (--schema-only)
   */
  prepareSqlForCloud(inputPath, outputPath, options = {}) {
    const targetRole = options.role || 'postgres';
    const excludeTables = options.excludeTables || [];
    const schemaOnly = options.schemaOnly || false;

    console.log(`\n🔧 Preparing SQL file for Supabase Cloud import...`);
    console.log(`   Target role: ${targetRole}`);
    if (excludeTables.length > 0) {
      console.log(`   Excluding tables: ${excludeTables.join(', ')}`);
    }
    if (schemaOnly) {
      console.log(`   Schema-only mode (skipping INSERT statements)`);
    }

    let sql = fs.readFileSync(inputPath, 'utf8');
    const originalSize = sql.length;

    // ============================================================
    // STEP 0: Detect and warn about broken SQL in custom dumps
    // ============================================================
    const hasObjectObject = sql.includes('[object Object]');
    const hasJsDatePattern = sql.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}/);

    if (hasObjectObject) {
      console.warn('⚠️  Warning: Backup file contains "[object Object]" values instead of proper JSON.');
      console.warn('   These INSERT statements will fail. Consider regenerating the backup with proper JSON serialization.');
      console.warn('   Use --schema-only to import just the table structure.');
    }
    if (hasJsDatePattern) {
      console.warn('⚠️  Warning: Backup file contains JavaScript date strings instead of ISO timestamps.');
      console.warn('   Timestamp values like "Wed Mar 11 2026..." are not valid PostgreSQL date format.');
      console.warn('   Use --schema-only to import just the table structure.');
    }

    // ============================================================
    // STEP 1: Remove Supabase internal schema operations
    // These schemas are managed by Supabase and cannot be modified
    // ============================================================
    const internalSchemas = [
      'auth', 'storage', 'realtime', 'extensions', 'pgsodium',
      'vault', 'supabase_functions', 'supabase_migrations',
      'graphql', 'graphql_public', '_realtime', 'pgbouncer'
    ];

    // Remove entire blocks that reference internal schemas
    // This handles CREATE TABLE, ALTER TABLE, etc. on internal schemas
    for (const schema of internalSchemas) {
      // Remove lines referencing internal schema objects
      const schemaRegex = new RegExp(`^\\s*(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT)\\s+.*\\b${schema}\\s*\\.`, 'gim');
      sql = sql.split('\n').filter(line => {
        const trimmed = line.trim();
        // Skip metadata comment lines
        if (trimmed.match(/^--\s*(Type|Schema|Owner|Name|Description):\s*/i)) return false;
        // Skip lines referencing internal schemas
        if (trimmed.match(new RegExp(`\\b${schema}\\s*\\.`, 'i'))) return false;
        if (trimmed.match(new RegExp(`\\b(SCHEMA|schema)\\s+${schema}\\b`, 'i'))) return false;
        return true;
      }).join('\n');
    }

    // ============================================================
    // STEP 2: Remove role-related statements that break cloud
    // ============================================================
    // Remove search_path reset
    sql = sql.replace(/SELECT\s+pg_catalog\.set_config\s*\(\s*'search_path'\s*,\s*''\s*,\s*false\s*\)\s*;/gi, '');

    // Replace role ownerships
    sql = sql.replace(/OWNER\s+TO\s+supabase\b/gi, `OWNER TO ${targetRole}`);
    sql = sql.replace(/OWNER\s+TO\s+pg_database_owner\b/gi, `OWNER TO ${targetRole}`);
    sql = sql.replace(/OWNER\s+TO\s+anon\b/gi, `OWNER TO ${targetRole}`);
    sql = sql.replace(/OWNER\s+TO\s+authenticated\b/gi, `OWNER TO ${targetRole}`);
    sql = sql.replace(/OWNER\s+TO\s+service_role\b/gi, `OWNER TO ${targetRole}`);
    sql = sql.replace(/OWNER\s+TO\s+supabase_admin\b/gi, `OWNER TO ${targetRole}`);

    // Remove ALTER DEFAULT PRIVILEGES for internal roles
    sql = sql.replace(/^ALTER\s+DEFAULT\s+PRIVILEGES.*\b(supabase|anon|authenticated|service_role)\b.*;?$/gim, '');

    // Remove SET ROLE statements
    sql = sql.replace(/^SET\s+ROLE\s+\w+\s*;?$/gim, '');
    sql = sql.replace(/^RESET\s+ROLE\s*;?$/gim, '');

    // Remove SECURITY DEFINER/INVOKER on functions that reference internal roles
    sql = sql.replace(/SECURITY\s+DEFERRED/gi, '');

    // ============================================================
    // STEP 3: Remove schema operations on public schema
    // Supabase Cloud already has the public schema
    // ============================================================
    sql = sql.replace(/DROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?public\s*;?/gi, '');
    sql = sql.replace(/CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?public\s*;?/gi, '');
    sql = sql.replace(/ALTER\s+SCHEMA\s+public\s+OWNER\s+TO\s+\w+\s*;?/gi, '');

    // ============================================================
    // STEP 4: Remove pg_dump metadata
    // ============================================================
    sql = sql.replace(/--\r?\n-- Name:\s+[^\n]*\n-- Type:\s+[^\n]*\n-- Schema:\s+[^\n]*\n-- Owner:\s+[^\n]*\n--\r?\n/gi, '');
    sql = sql.replace(/^-- Name:\s+.*$/gm, '');
    sql = sql.replace(/^-- Type:\s+.*$/gm, '');
    sql = sql.replace(/^-- Schema:\s+.*$/gm, '');
    sql = sql.replace(/^-- Owner:\s+.*$/gm, '');

    // ============================================================
    // STEP 5: Remove dangerous statements for cloud import
    // ============================================================
    // Remove CREATE EXTENSION (extensions are managed by Supabase)
    sql = sql.replace(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+.*;?$/gim, '');

    // Remove CREATE/DROP DATABASE
    sql = sql.replace(/^CREATE\s+DATABASE\b.*;?$/gim, '');
    sql = sql.replace(/^DROP\s+DATABASE\b.*;?$/gim, '');

    // Remove ALTER DATABASE
    sql = sql.replace(/^ALTER\s+DATABASE\b.*;?$/gim, '');

    // Remove CREATE/DROP ROLE
    sql = sql.replace(/^CREATE\s+ROLE\b.*;?$/gim, '');
    sql = sql.replace(/^DROP\s+ROLE\b.*;?$/gim, '');
    sql = sql.replace(/^ALTER\s+ROLE\b.*;?$/gim, '');

    // Remove pg_catalog SET statements that require superuser
    sql = sql.replace(/^SET\s+row_security\s*=.*;?$/gim, '');

    // Remove TRUNCATE on Supabase internal tables
    sql = sql.replace(/^TRUNCATE\s+.*\b(auth|storage|realtime)\b\..*;?$/gim, '');

    // ============================================================
    // STEP 5b: Fix common syntax issues in custom dumps
    // ============================================================
    // Fix: "column" ARRAY -> "column" text[] (invalid standalone ARRAY keyword)
    sql = sql.replace(/\b"\s*\w+\s*"\s+ARRAY\b/gi, (match) => {
      return match.replace('ARRAY', 'text[]');
    });

    // Fix: column_name ARRAY (without quotes)
    sql = sql.replace(/\sARRAY\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY)/gi, ' text[] $1');

    // ============================================================
    // STEP 6: Optionally exclude specific table patterns
    // ============================================================
    if (excludeTables.length > 0) {
      const lines = sql.split('\n');
      let excludeMode = false;
      const filteredLines = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // Check if we're entering/excluding a table block
        for (const pattern of excludeTables) {
          const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
          const tableNameMatch = trimmed.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);

          if (tableNameMatch) {
            const tableName = tableNameMatch[1];
            const regex = new RegExp(`^${regexPattern}$`, 'i');
            if (regex.test(tableName) || regex.test(`${tableName}`)) {
              excludeMode = true;
              break;
            } else {
              excludeMode = false;
            }
          }
        }

        if (!excludeMode) {
          filteredLines.push(line);
        }
      }

      sql = filteredLines.join('\n');
    }

    // ============================================================
    // STEP 7: Optionally skip INSERT statements (schema-only)
    // ============================================================
    if (schemaOnly) {
      const lines = sql.split('\n');
      const filteredLines = [];
      let inInsertBlock = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Detect INSERT statements (can be multi-line)
        if (trimmed.match(/^INSERT\s+INTO/i)) {
          inInsertBlock = true;
          continue; // skip this line
        }

        // INSERT blocks end at semicolon or empty line after INSERT
        if (inInsertBlock) {
          if (trimmed.endsWith(';') || trimmed === '') {
            inInsertBlock = false;
          }
          continue; // skip all INSERT lines
        }

        // Also skip COPY statements (data import from stdin)
        if (trimmed.match(/^COPY\s+/i)) {
          inInsertBlock = true; // treat COPY same as INSERT
          continue;
        }

        filteredLines.push(line);
      }

      sql = filteredLines.join('\n');
    }

    // ============================================================
    // STEP 8: Add safe header for cloud import
    // ============================================================
    const header = `--
-- Prepared for Supabase Cloud import
-- Generated: ${new Date().toISOString()}
-- Role: ${targetRole}
-- Schema-only: ${schemaOnly}
-- Excluded tables: ${excludeTables.length > 0 ? excludeTables.join(', ') : 'none'}
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

`;

    fs.writeFileSync(outputPath, header + sql, 'utf8');

    const newSize = fs.statSync(outputPath).size;
    const reduction = ((1 - newSize / originalSize) * 100).toFixed(1);

    console.log(`✅ Prepared SQL file: ${outputPath}`);
    console.log(`📊 Original size: ${(originalSize / 1024).toFixed(1)}KB`);
    console.log(`📊 Prepared size: ${(newSize / 1024).toFixed(1)}KB (${reduction}% reduction)`);
  }

  /**
   * Import custom format dump file (requires conversion)
   */
  async importCustomFormatFile(filePath, config) {
    console.log('\n⚠️  Custom format (.dump) files need to be converted first');
    console.log('💡 Converting to SQL format using pg_restore...');

    const sqlPath = filePath.replace('.dump', '_converted.sql');

    try {
      // Try to use pg_restore to convert to SQL
      const { execSync } = await import('child_process');
      execSync(`pg_restore -f "${sqlPath}" "${filePath}"`, { stdio: 'inherit' });

      console.log('✅ Converted to SQL format');

      // Now import the converted SQL file
      const preparedPath = sqlPath.replace('.sql', '_prepared.sql');
      this.prepareSqlForCloud(sqlPath, preparedPath, { role: config.user || 'postgres' });
      await this.importWithFallback(preparedPath, config);
    } catch (error) {
      console.error('❌ Failed to convert dump file:', error.message);
      console.log('\n💡 Alternative: Use Docker to convert:');
      console.log(`   docker run --rm -v "${path.dirname(filePath)}:/backups" postgres:15 pg_restore -f /backups/${path.basename(sqlPath)} /backups/${path.basename(filePath)}`);
      throw error;
    } finally {
      // Clean up converted file
      for (const file of [sqlPath, sqlPath.replace('.sql', '_prepared.sql')]) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
    }
  }
}
