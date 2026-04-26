import { TypeValidationAdapter } from '../abstract/TypeValidationAdapter.js';

/**
 * Generic type validation adapter that can be used by any datasource
 */
export class GenericTypeValidationAdapter extends TypeValidationAdapter {
  validateFieldType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'timestamp':
        return value instanceof Date || (value && typeof value.toDate === 'function'); // Firestore Timestamp
      case 'null':
        return value === null;
      default:
        return true; // Unknown types pass validation
    }
  }

  defaultForType(type) {
    switch (type) {
      case 'string': return '';
      case 'int32':
      case 'float': return 0;
      case 'bool': return false;
      case 'string[]':
      case 'int32[]':
      case 'float[]': return [];
      default: return null;
    }
  }

  castValue(value, type) {
    // Handle null and undefined values based on field type
    if (value === null || value === undefined) {
      // Return appropriate defaults for missing values based on expectations
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