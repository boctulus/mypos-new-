import { TypesenseAdapter } from '../abstract/TypesenseAdapter.js';

/**
 * Generic Typesense adapter that can be used by any datasource
 */
export class GenericTypesenseAdapter extends TypesenseAdapter {
  async transformDataForTypesense(model, data) {
    try {
      // This would typically load the schema from a specific location based on the model's datasource
      // For now, we'll simulate the original behavior with a dynamic import
      const path = await import('path');
      const { pathToFileURL } = await import('url');

      const schemaPath = path.resolve(
        process.cwd(),
        `database/typesense/schemas/${model.entity}/${model.entity}.schema.js`
      );

      const schemaUrl = pathToFileURL(schemaPath).href;
      const schemaModule = await import(schemaUrl);
      const schema = schemaModule.default;

      const transformed = { id: data.id };
      for (const field of schema.fields) {
        const { name, type, optional } = field;
        let value = data[name];

        if (value && typeof value === 'object' && '_seconds' in value) {
          value = type === 'int64'
            ? value._seconds * 1000 + Math.floor(value._nanoseconds / 1000000)
            : value.toDate();
        }
        if (value instanceof Date) value = value.toISOString();

        // Use the model's castValue method or fallback to a generic one
        const castValue = model.castValue ? model.castValue(value, type) : this.castValue(value, type);

        // Always include the field - castValue now handles appropriate defaults
        transformed[name] = castValue;
      }

      if (model.useTenantSubcollections && model.tenantId) {
        transformed.tenant_id = model.tenantId;
      }

      return transformed;
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        console.warn(`⚠️ Warning: Typesense schema not found for '${model.entity}'. Skipping Typesense sync.`);
        return false;
      } else {
        console.error(`Error loading Typesense schema for ${model.entity}:`, error);
        throw new Error(`Could not load Typesense schema for ${model.entity}`);
      }
    }
  }

  async syncSubcollectionsWithTypesense(model, parentId, parentData, action) {
    // This would be implemented based on the specific datasource
    // For now, throwing an error as it was in the original code
    throw new Error(`Not Implemented`);
  }

  // Fallback castValue method if model doesn't have one
  castValue(value, type) {
    // Handle null and undefined values based on field type
    if (value === null || value === undefined) {
      // Return appropriate defaults for missing values based on Typesense expectations
      switch (type) {
        case 'bool': return false; // Missing bool fields should default to false
        case 'string': return ''; // Missing string fields should default to empty string
        case 'int64':
        case 'int32':
        case 'float': return 0; // Missing numeric fields should default to 0
        case 'string[]':
        case 'int32[]':
        case 'float[]': return []; // Missing array fields should default to empty array
        default: return null;
      }
    }

    switch (type) {
      case 'string': return String(value);
      case 'int64':
        const int64Value = parseInt(value, 10);
        return isNaN(int64Value) ? 0 : int64Value;
      case 'int32':
        const int32Value = parseInt(value, 10);
        return isNaN(int32Value) ? 0 : int32Value;
      case 'float':
        const floatValue = parseFloat(value);
        return isNaN(floatValue) ? 0 : floatValue;
      case 'bool':
        // Handle correctly strings from HTML forms
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        return Boolean(value);
      case 'string[]':
        return Array.isArray(value) ? value.map(String) : [];
      case 'int32[]':
        return Array.isArray(value) ? value.map(v => parseInt(v, 10)) : [];
      case 'float[]':
        return Array.isArray(value) ? value.map(v => parseFloat(v)) : [];
      default: return value;
    }
  }
}