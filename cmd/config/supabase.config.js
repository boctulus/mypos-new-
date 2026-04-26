// config/supabase.config.js
/**
 * Supabase Configuration
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Configuration for Supabase adapter that replaces Firebase
 */

export const SUPABASE_CONFIG = {
  // Query limits
  MAX_LIMIT: parseInt(process.env.MAX_QUERY_LIMIT || '100'),
  DEFAULT_LIMIT: 20,

  // Allowed collections (whitelist)
  ALLOWED_COLLECTIONS: [
    'users',
    'products',
    'categories',
    'customers',
    'sales',
    'stores',
    'branches',
    'cashboxes',
    'cashbox_sessions',
    'cashbox_movements',
    'inventory_movements',
    'notifications',
    'providers',
    'bundles',
    'recipes',
    'restaurant_layouts',
    'tax_documents',
    'taxes',
    'tickets',
    'shopping_carts',
    'user_stores',
    // Test collections
    'test_users',
    'test_products',
    'test_stores',
    'test_customers',
  ],

  // Foreign key naming convention
  // Example: 'posts' table -> foreign key 'post_id' (singular)
  // Example: 'categories' table -> foreign key 'category_id' (singular)
  FK_CONVENTION: (collectionName) => {
    // Handle common irregular plurals
    const pluralToSingular = {
      'categories': 'category',
      'people': 'person',
      'entries': 'entry',
      'statuses': 'status',
      'bundles': 'bundle',
      'recipes': 'recipe',
      'taxes': 'tax',
      'branches': 'branch',
      'cashboxes': 'cashbox',
    }

    const singular = pluralToSingular[collectionName] ||
      (collectionName.endsWith('s') ? collectionName.slice(0, -1) : collectionName)

    return `${singular}_id`
  },

  // Performance settings
  QUERY_TIMEOUT_MS: parseInt(process.env.QUERY_TIMEOUT_MS || '30000'),
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,

  // Logging
  LOG_REQUESTS: process.env.NODE_ENV !== 'production',
  LOG_PERFORMANCE: process.env.LOG_PERFORMANCE === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info' // 'debug' | 'info' | 'warn' | 'error'
}
