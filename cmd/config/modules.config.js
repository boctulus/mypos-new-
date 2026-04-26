export default [
  'restaurant', // MOVED TO FIRST POSITION FOR DEBUG
  'providers',
  'customers',
  'cashbox',
  'users',
  'stores',
  'products',
  'branches',
  'categories',
  'taxes',
  'sales',
  'tax_documents', // Documentos tributarios electrónicos
  'bundles',
  'tickets',

  // POS Systems:
  'price-verifier',

  // Cache:
  'cache',

  // Reports & Analytics (MUST BE BEFORE ACCOUNT):
  'reports',

  // Account & Admin:
  'account',
  'admin_tasks',

  'logs',
  // 'notifications',
  'settings',
  'invoicing',
  'security',

  // De pruebas:
  'test-img-upload',
  'test_html_helper',
  'test-components'

  // Otros módulos aquí según sea necesario
  // ...
];