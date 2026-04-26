import { SchemaAdapter } from '../abstract/SchemaAdapter.js';

/**
 * Generic schema adapter that can be used by any datasource
 */
export class GenericSchemaAdapter extends SchemaAdapter {
  async loadSchema(entity) {
    // This would be implemented differently depending on the datasource
    // For now, returning null to indicate no schema
    return null;
  }

  validateAgainstSchema(schema, data, isUpdate = false) {
    if (!schema) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    const fields = schema.fields || {};
    const required = schema.required?.fields || [];

    // Validate required fields (only in creation, not in updates)
    if (!isUpdate) {
      for (const requiredField of required) {
        // Treat auto-set fields as optional during creation
        if (requiredField === 'deleted_at' || requiredField === 'created_at' || requiredField === 'updated_at') {
          continue;
        }

        if (!(requiredField in data) || data[requiredField] === null || data[requiredField] === undefined) {
          errors.push(`Field '${requiredField}' is required`);
        }
      }
    }

    // Validate data types - excluding idField from type validation since it's handled separately
    for (const [fieldName, value] of Object.entries(data)) {
      if (fieldName === 'id') { // Assuming 'id' is the default idField
        continue; // Skip idField validation - handled in the model
      }

      if (value === null || value === undefined) {
        continue; // Skip null/undefined values for type checking
      }

      const expectedType = fields[fieldName];
      if (!expectedType) {
        errors.push(`Field '${fieldName}' is not defined in schema`);
        continue;
      }

      // This assumes a type validator is available
      // In practice, you'd inject the appropriate TypeValidationAdapter
      // For now, we'll skip the type validation part in this generic implementation
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  isSoftDeleteEnabled(schema) {
    if (!schema || !schema.fields) {
      return false;
    }
    return 'deleted_at' in schema.fields;
  }
}