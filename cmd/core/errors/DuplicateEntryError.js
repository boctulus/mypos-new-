export default class DuplicateEntryError extends Error {
  constructor(field, value) {
    super(`Error de duplicidad: El valor "${value}" para el campo "${field}" ya existe.`);
    this.name = 'DuplicateEntryError';
    this.field = field;
    this.value = value;
    this.statusCode = 409;
  }
}