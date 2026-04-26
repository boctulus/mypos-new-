import { TypeValidationAdapter } from '../abstract/TypeValidationAdapter.js';
import { SchemaAdapter } from '../abstract/SchemaAdapter.js';
import { TypesenseAdapter } from '../abstract/TypesenseAdapter.js';
import { GenericTypeValidationAdapter } from '../generic/GenericTypeValidationAdapter.js';
import { GenericSchemaAdapter } from '../generic/GenericSchemaAdapter.js';
import { GenericTypesenseAdapter } from '../generic/GenericTypesenseAdapter.js';
import { FirebaseTypeValidationAdapter } from '../vendor/firebase/FirebaseTypeValidationAdapter.js';
import { FirebaseSchemaAdapter } from '../vendor/firebase/FirebaseSchemaAdapter.js';
import { SupabaseTypeValidationAdapter } from '../vendor/supabase/SupabaseTypeValidationAdapter.js';
import { SupabaseSchemaAdapter } from '../vendor/supabase/SupabaseSchemaAdapter.js';
import { TypesenseFirebaseAdapter } from '../vendor/typesense/TypesenseFirebaseAdapter.js';
import { TypesensePostgresAdapter } from '../vendor/typesense/TypesensePostgresAdapter.js';

/**
 * Factory class to create appropriate adapters based on datasource type
 */
export class AdapterFactory {
  /**
   * Creates a type validation adapter based on the datasource
   * @param {string} datasourceType - The type of datasource ('firebase', 'supabase', etc.)
   * @returns {TypeValidationAdapter} An instance of the appropriate type validation adapter
   */
  static createTypeValidationAdapter(datasourceType) {
    switch (datasourceType.toLowerCase()) {
      case 'firebase':
        return new FirebaseTypeValidationAdapter();
      case 'supabase':
      case 'postgres':
        return new SupabaseTypeValidationAdapter();
      default:
        return new GenericTypeValidationAdapter();
    }
  }

  /**
   * Creates a schema adapter based on the datasource
   * @param {string} datasourceType - The type of datasource ('firebase', 'supabase', etc.)
   * @returns {SchemaAdapter} An instance of the appropriate schema adapter
   */
  static createSchemaAdapter(datasourceType) {
    switch (datasourceType.toLowerCase()) {
      case 'firebase':
        return new FirebaseSchemaAdapter();
      case 'supabase':
      case 'postgres':
        return new SupabaseSchemaAdapter();
      default:
        return new GenericSchemaAdapter();
    }
  }

  /**
   * Creates a Typesense adapter based on the datasource
   * @param {string} datasourceType - The type of datasource ('firebase', 'supabase', etc.)
   * @returns {TypesenseAdapter} An instance of the appropriate Typesense adapter
   */
  static createTypesenseAdapter(datasourceType) {
    switch (datasourceType.toLowerCase()) {
      case 'firebase':
        return new TypesenseFirebaseAdapter();
      case 'postgres':
        return new TypesensePostgresAdapter();
      default:
        return new GenericTypesenseAdapter();
    }
  }
}