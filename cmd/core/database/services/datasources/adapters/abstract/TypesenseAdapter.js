/**
 * Abstract base class for Typesense adapters
 */
export class TypesenseAdapter {
  /**
   * Transforms data for Typesense schema
   * @param {Object} model - The model instance
   * @param {Object} data - The data to transform
   * @returns {Promise<Object|boolean>} The transformed data or false if schema not found
   */
  async transformDataForTypesense(model, data) {
    throw new Error('transformDataForTypesense() must be implemented');
  }

  /**
   * Synchronizes subcollections with Typesense
   * @param {Object} model - The model instance
   * @param {string} parentId - The parent document ID
   * @param {Object} parentData - The parent document data
   * @param {string} action - The action performed
   * @returns {Promise<void>}
   */
  async syncSubcollectionsWithTypesense(model, parentId, parentData, action) {
    throw new Error('syncSubcollectionsWithTypesense() must be implemented');
  }
}