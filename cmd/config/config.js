/**
 * Configuración Global de FriendlyPOS
 *
 * @author Pablo Bozzolo (boctulus)
 * @description Archivo de compatibilidad - Redirige a la configuración del módulo invoicing
 *
 * DEPRECADO: Este archivo se mantiene solo para compatibilidad con código legacy.
 * La configuración de facturación electrónica ahora está en modules/invoicing/
 *
 * TODO: Actualizar todos los imports que usen este archivo y luego eliminarlo.
 */

// Re-exportar desde el módulo invoicing para compatibilidad
export { invoicingConfig as config } from '../modules/invoicing/config/config.js';
export {
    isElectronicInvoicingEnabled,
    canAccessFiscalDocuments,
    getGenericRUT,
    getDocumentTypes
} from '../modules/invoicing/helpers/electronic-invoicing.js';

// Mensaje de advertencia en consola
console.warn(
    '[DEPRECATED] config/config.js está deprecado. ' +
    'Usa modules/invoicing/config/config.js en su lugar.'
);

export default { electronicInvoicing: {} }; // Compatibilidad
