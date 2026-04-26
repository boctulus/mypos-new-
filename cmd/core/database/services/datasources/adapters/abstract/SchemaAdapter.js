/**
 * Abstract base class for schema adapters
 */
export class SchemaAdapter {
  /**
   * Loads the schema for the model
   * @param {string} entity - The entity name
   * @returns {Promise<Object|null>} The loaded schema or null if not found
   */
  async loadSchema(entity) {
    throw new Error('loadSchema() must be implemented');
  }

  /**
   * Validates data against the schema
   * @param {Object} schema - The schema to validate against
   * @param {Object} data - The data to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @returns {{valid: boolean, errors: Array<string>}} Validation result
   */
  validateAgainstSchema(schema, data, isUpdate = false) {
    throw new Error('validateAgainstSchema() must be implemented');
  }

  /**
   * Checks if soft delete is enabled in the schema
   * @param {Object} schema - The schema to check
   * @returns {boolean} True if soft delete is enabled
   */
  isSoftDeleteEnabled(schema) {
    throw new Error('isSoftDeleteEnabled() must be implemented');
  }
}