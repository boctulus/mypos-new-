/**
 * Abstract base class for type validation adapters
 */
export class TypeValidationAdapter {
  /**
   * Validates the type of a field value
   * @param {*} value - The value to validate
   * @param {string} expectedType - The expected type
   * @returns {boolean} True if the value matches the expected type
   */
  validateFieldType(value, expectedType) {
    throw new Error('validateFieldType() must be implemented');
  }

  /**
   * Gets the default value for a specific type
   * @param {string} type - The type
   * @returns {*} The default value for the type
   */
  defaultForType(type) {
    throw new Error('defaultForType() must be implemented');
  }

  /**
   * Casts a value to a specific type
   * @param {*} value - The value to cast
   * @param {string} type - The target type
   * @returns {*} The cast value
   */
  castValue(value, type) {
    throw new Error('castValue() must be implemented');
  }
}