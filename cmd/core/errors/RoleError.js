export default class RoleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoleError';
  }
}