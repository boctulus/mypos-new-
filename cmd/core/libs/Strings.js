import { randomBytes } from 'crypto';

export default class Strings {
  // Función auxiliar para convertir a camelCase
  static toCamelCase(str) {
    return str
        .split('_')
        .map((word, index) => {
            if (index === 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');
  }

  // Función auxiliar para convertir a PascalCase
  static toPascalCase(str) {
    return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
  }

  static toSnakeCase(str) {
    return str
      // Insertar guion bajo antes de mayúsculas precedidas por minúsculas o números
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      // Reemplazar guiones y espacios por guiones bajos
      .replace(/[-\s]+/g, '_')
      // Convertir todo a minúsculas
      .toLowerCase()
      // Quitar guiones bajos duplicados y bordes
      .replace(/__+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  static generateRandomPassword(length = 8) {
    return randomBytes(length)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, length);
  }

  static accents2Ascii(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  static fixBOM(str) {
    return str.replace(/\uFEFF/g, "");
  }

  static replaceNonAllowedChars(str, allowed, replaceWith = "") {
    const regex = new RegExp(`[^${allowed}]`, "gi");
    return str.replace(regex, replaceWith);
  }

  static trim(str) {
    return str.trim();
  }

  static replaceDupes(str, char) {
    const regex = new RegExp(`${char}+`, "g");
    return str.replace(regex, char);
  }

  static sanitize(str, replaceAccents = true, trim = false, allowed = "a-z0-9- ") {
    if (replaceAccents) {
      str = Strings.accents2Ascii(str);
      str = Strings.fixBOM(str);
    }

    str = str.replace(/_/g, "-");

    if (allowed && allowed.length > 0) {
      str = Strings.replaceNonAllowedChars(str, allowed, "");
    }

    if (trim) {
      str = Strings.trim(str);
    }

    return str;
  }

  static slug(str) {
    str = str.replace(/\//g, "");
    str = Strings.sanitize(str, true, true);
    str = str.toLowerCase();
    str = str.replace(/ /g, "-");
    str = str.replace(/\./g, "");
    str = Strings.replaceDupes(str, "-");
    return str.replace(/^-+|-+$/g, "");
  }

  /**
   * Serializa un objeto a JSON de forma segura para uso en vistas EJS
   * Remueve caracteres de control problemáticos que pueden causar errores de sintaxis
   *
   * @param {Object} obj - Objeto a serializar
   * @returns {string} - JSON string seguro para insertar en HTML/JavaScript
   *
   * @example
   * // En una vista EJS (Node.js):
   * <%
   *   const Strings = (await import('./core/libs/Strings.js')).default;
   * %>
   * <script type="application/json" id="userData">
   * <%- Strings.safeStringify(user) %>
   * </script>
   *
   * @note
   * ⚠️ IMPORTANTE: Usar esta función en lugar de JSON.stringify() directo en vistas
   * para evitar errores de sintaxis cuando los datos contienen:
   * - Caracteres de control (backspace, form feed, etc.)
   * - Backslashes sin escapar
   * - Caracteres raros de control ASCII
   *
   * @see docs/core/libs/strings-safe-stringify.md para más detalles
   *
   * @author Pablo Bozzolo (boctulus)
   * @since 2025-11-09
   */
  static safeStringify(obj) {
    return JSON.stringify(obj || {}, (key, value) => {
      if (typeof value === 'string') {
        // Remover caracteres de control problemáticos (excepto \n, \r, \t que JSON.stringify maneja)
        // Rango: \x00-\x08 (NULL-BS), \x0B (VT), \x0C (FF), \x0E-\x1F (SO-US), \x7F (DEL)
        return value
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remover caracteres de control
          .replace(/\\/g, '\\\\'); // Escapar backslashes correctamente
      }
      return value;
    });
  }

  /**
   * Calcula el dígito verificador de un RUT chileno
   *
   * @param {string|number} rut - RUT sin dígito verificador
   * @returns {string} - Dígito verificador ('0'-'9' o 'K')
   *
   * @example
   * Strings.calcularDV('76070273') // '6'
   * Strings.calcularDV(76070273)   // '6'
   *
   * @author Pablo Bozzolo (boctulus)
   * @since 2025-11-29
   */
  static calcularDV(rut) {
    const rutStr = String(rut).replace(/\./g, '').replace(/-/g, '');

    let suma = 0;
    let multiplicador = 2;

    for (let i = rutStr.length - 1; i >= 0; i--) {
      suma += parseInt(rutStr[i]) * multiplicador;
      multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
    }

    const dvCalculado = 11 - (suma % 11);
    return dvCalculado === 11 ? '0' : dvCalculado === 10 ? 'K' : dvCalculado.toString();
  }

  /**
   * Formatea un RUT chileno agregando el dígito verificador si no lo tiene
   *
   * @param {string|number} rut - RUT con o sin dígito verificador
   * @param {boolean} conPuntos - Si se debe formatear con puntos y guión (default: true)
   * @returns {string} - RUT formateado (ej: "76.070.273-6" o "76070273-6")
   *
   * @example
   * Strings.formatRUT('76070273')           // '76.070.273-6'
   * Strings.formatRUT(76070273)             // '76.070.273-6'
   * Strings.formatRUT('76070273', false)    // '76070273-6'
   * Strings.formatRUT('76070273-6')         // '76.070.273-6' (mantiene DV si ya existe)
   *
   * @author Pablo Bozzolo (boctulus)
   * @since 2025-11-29
   */
  static formatRUT(rut, conPuntos = true) {
    if (!rut) return '';

    // Convertir a string y limpiar puntos y guiones
    const rutOriginal = String(rut);
    const rutLimpio = rutOriginal.replace(/\./g, '').replace(/-/g, '').toUpperCase();

    // Separar cuerpo y DV
    let cuerpo, dv;

    // Si el último carácter no es un número, es el DV
    if (rutLimpio.length > 1 && isNaN(rutLimpio[rutLimpio.length - 1])) {
      cuerpo = rutLimpio.slice(0, -1);
      dv = rutLimpio.slice(-1);
    }
    // Si el RUT original tenía guión, significa que ya tiene DV
    else if (rutOriginal.includes('-')) {
      cuerpo = rutLimpio.slice(0, -1);
      dv = rutLimpio.slice(-1);
    }
    // No tiene DV, calcularlo
    else {
      cuerpo = rutLimpio;
      dv = Strings.calcularDV(cuerpo);
    }

    // Formatear con puntos si se solicita
    if (conPuntos && cuerpo.length > 3) {
      cuerpo = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    return `${cuerpo}-${dv}`;
  }

  /**
   * Valida un RUT chileno
   *
   * @param {string} rut - RUT a validar (puede tener o no puntos y guión)
   * @returns {boolean} - true si el RUT es válido
   *
   * @example
   * Strings.validarRUT('76.070.273-6')  // true
   * Strings.validarRUT('76070273-6')    // true
   * Strings.validarRUT('76070273-5')    // false
   *
   * @author Pablo Bozzolo (boctulus)
   * @since 2025-11-29
   */
  static validarRUT(rut) {
    if (!rut) return false;

    const rutLimpio = String(rut).replace(/\./g, '').replace(/-/g, '').toUpperCase();

    if (rutLimpio.length < 2) return false;

    const cuerpo = rutLimpio.slice(0, -1);
    const dv = rutLimpio.slice(-1);
    const dvCalculado = Strings.calcularDV(cuerpo);

    return dv === dvCalculado;
  }
}
