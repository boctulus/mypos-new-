// databases.config.js
import EnvLoader from '../core/libs/EnvLoader.js'
EnvLoader.load()

const env = (key, defaultValue = undefined) => {
    if (process.env[key] === undefined || process.env[key] === '') {
        return defaultValue
    }
    return process.env[key]
}

export default {
    /**
     * Enabled datasources for multi-datasource support
     */
    enabledDatasources: {
        firebase: true,
        supabase: true,
    },

    /**
     * Default datasource for models
     */
    defaultModelDatasource: 'firebase',

    /**
     * Per-model datasource configuration
     * Use this to override the default datasource for specific models
     */
    modelDatasources: {
        users: 'firebase',
    },

    db_connections: {
        /**
         * Supabase PostgreSQL
         */
        main: {
            driver: 'pgsql',
            host: env('SUPABASE_HOST', 'aws-1-us-east-1.pooler.supabase.com'), // Supabase Connection Pooler (Session mode)
            port: Number(env('SUPABASE_PORT', 5432)),
            db_name: env('SUPABASE_DATABASE', 'postgres'), // Supabase uses postgres by default
            user: env('SUPABASE_USER', `postgres.${env('SUPABASE_PROJECT_REF', 'srcgnmyevaavcaazrorr')}`), // Format: postgres.project_ref
            pass: env('SUPABASE_PASSWORD', env('SUPABASE_DB_PASSWORD')), // Use DB password, not SERVICE_KEY (which is JWT for API)
            charset: 'utf8',
            schema: 'public',
            client_options: {
                ssl: {
                    rejectUnauthorized: false // Required for Supabase
                },
                application_name: 'node-app',
                connectionTimeoutMillis: 20000, // Increased timeout
                idleTimeoutMillis: 30000,
                max: 2, // Reduced max connections for Supabase
                statement_timeout: 60000,
            },
        },

        /**
         * PostgreSQL (conexión directa)
         */
        pgsql_direct: {
            driver: 'pgsql',
            host: env('POSTGRES_HOST', '127.0.0.1'),
            port: Number(env('POSTGRES_PORT', 5432)),
            db_name: env('POSTGRES_DATABASE', 'postgres'),
            user: env('POSTGRES_USERNAME', 'postgres'),
            pass: env('POSTGRES_PASSWORD'),
            charset: 'utf8',
            schema: 'public',
            client_options: {
                ssl: false,
                application_name: 'node-app',
            },
        },
    },

    /**
     * Default connection
     */
    db_connection_default: 'supabase',
}
