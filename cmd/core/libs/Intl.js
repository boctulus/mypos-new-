/**
 * Internationalization Library
 *
 * Biblioteca para manejo de internacionalización (i18n) del sistema.
 * Proporciona funciones utilitarias para formatear moneda, números y fechas
 * según la configuración regional definida.
 *
 * @module core/libs/Intl
 * @author Pablo Bozzolo <boctulus@gmail.com>
 *
 * @example
 * import Intl from './core/libs/Intl.js';
 *
 * const intl = new Intl(config);
 * console.log(intl.formatCurrency(1500)); // "$1.500"
 */

export default class Intl {
  /**
   * Constructor de la clase Intl
   *
   * @param {Object} config - Configuración de internacionalización
   * @param {string} config.locale - Código de locale (ej: 'es-CL', 'en-US')
   * @param {Object} config.currency - Configuración de moneda
   * @param {string} config.currency.code - Código ISO 4217 (ej: 'CLP', 'USD')
   * @param {string} config.currency.style - Estilo de formato ('currency', 'accounting')
   * @param {number} config.currency.minimumFractionDigits - Mínimo de decimales
   * @param {number} config.currency.maximumFractionDigits - Máximo de decimales
   * @param {string} config.currency.currencyDisplay - Tipo de display ('symbol', 'code', 'name')
   * @param {Object} config.number - Configuración de números
   * @param {boolean} config.number.useGrouping - Usar separador de miles
   * @param {Object} config.date - Configuración de fechas
   * @param {string} config.date.shortFormat - Formato corto (ej: 'DD/MM/YYYY')
   * @param {string} config.date.longFormat - Formato largo
   * @param {string} config.date.timezone - Zona horaria (ej: 'America/Santiago')
   */
  constructor(config) {
    if (!config) {
      throw new Error('Intl: Se requiere un objeto de configuración');
    }

    this.config = config;
    this.locale = config.locale;
    this.currencyConfig = config.currency;
    this.numberConfig = config.number;
    this.dateConfig = config.date;
  }

  /**
   * Obtiene un formateador de moneda configurado
   *
   * @param {Object} options - Opciones adicionales de formato
   * @returns {Intl.NumberFormat} Formateador de moneda
   *
   * @example
   * const formatter = intl.getCurrencyFormatter();
   * console.log(formatter.format(1000)); // "$1.000" (en es-CL)
   */
  getCurrencyFormatter(options = {}) {
    return new global.Intl.NumberFormat(this.locale, {
      style: this.currencyConfig.style,
      currency: this.currencyConfig.code,
      minimumFractionDigits: options.minimumFractionDigits ?? this.currencyConfig.minimumFractionDigits,
      maximumFractionDigits: options.maximumFractionDigits ?? this.currencyConfig.maximumFractionDigits,
      currencyDisplay: options.currencyDisplay ?? this.currencyConfig.currencyDisplay,
      ...options
    });
  }

  /**
   * Formatea un valor numérico como moneda
   *
   * @param {number|string} value - Valor a formatear
   * @param {Object} options - Opciones adicionales de formato
   * @returns {string} Valor formateado como moneda
   *
   * @example
   * intl.formatCurrency(1500); // "$1.500" (en es-CL con CLP)
   * intl.formatCurrency(1500.50, { minimumFractionDigits: 2 }); // "$1.500,50"
   */
  formatCurrency(value, options = {}) {
    const price = parseFloat(value) || 0;
    const formatter = this.getCurrencyFormatter(options);
    return formatter.format(price);
  }

  /**
   * Obtiene un formateador de números configurado
   *
   * @param {Object} options - Opciones adicionales de formato
   * @returns {Intl.NumberFormat} Formateador de números
   *
   * @example
   * const formatter = intl.getNumberFormatter();
   * console.log(formatter.format(1000)); // "1.000" (en es-CL)
   */
  getNumberFormatter(options = {}) {
    return new global.Intl.NumberFormat(this.locale, {
      useGrouping: options.useGrouping ?? this.numberConfig.useGrouping,
      ...options
    });
  }

  /**
   * Formatea un valor numérico
   *
   * @param {number|string} value - Valor a formatear
   * @param {Object} options - Opciones adicionales de formato
   * @returns {string} Valor formateado
   *
   * @example
   * intl.formatNumber(1500); // "1.500" (en es-CL)
   * intl.formatNumber(1500.75, { minimumFractionDigits: 2 }); // "1.500,75"
   */
  formatNumber(value, options = {}) {
    const number = parseFloat(value) || 0;
    const formatter = this.getNumberFormatter(options);
    return formatter.format(number);
  }

  /**
   * Obtiene la configuración completa de internacionalización
   *
   * @returns {Object} Configuración de internacionalización
   */
  getConfig() {
    return this.config;
  }

  /**
   * Obtiene solo el locale configurado
   *
   * @returns {string} Locale (ej: 'es-CL')
   */
  getLocale() {
    return this.locale;
  }

  /**
   * Obtiene solo el código de moneda configurado
   *
   * @returns {string} Código de moneda (ej: 'CLP')
   */
  getCurrencyCode() {
    return this.currencyConfig.code;
  }

  /**
   * Obtiene el símbolo de la moneda
   *
   * @returns {string} Símbolo de moneda (ej: '$')
   *
   * @example
   * intl.getCurrencySymbol(); // "$" (para es-CL con CLP)
   */
  getCurrencySymbol() {
    const formatter = this.getCurrencyFormatter();
    const parts = formatter.formatToParts(0);
    const symbolPart = parts.find(part => part.type === 'currency');
    return symbolPart ? symbolPart.value : this.currencyConfig.code;
  }

  /**
   * Obtiene la configuración de moneda
   *
   * @returns {Object} Configuración de moneda
   */
  getCurrencyConfig() {
    return this.currencyConfig;
  }

  /**
   * Obtiene la configuración de números
   *
   * @returns {Object} Configuración de números
   */
  getNumberConfig() {
    return this.numberConfig;
  }

  /**
   * Obtiene la configuración de fechas
   *
   * @returns {Object} Configuración de fechas
   */
  getDateConfig() {
    return this.dateConfig;
  }

  /**
   * Formatea una fecha según el formato corto configurado
   *
   * @param {Date|string|number} date - Fecha a formatear
   * @returns {string} Fecha formateada
   *
   * @example
   * intl.formatDateShort(new Date()); // "31/10/2025"
   */
  formatDateShort(date) {
    const d = new Date(date);
    const formatter = new global.Intl.DateTimeFormat(this.locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: this.dateConfig.timezone
    });
    return formatter.format(d);
  }

  /**
   * Formatea una fecha según el formato largo configurado
   *
   * @param {Date|string|number} date - Fecha a formatear
   * @returns {string} Fecha formateada
   *
   * @example
   * intl.formatDateLong(new Date()); // "31/10/2025 14:30:00"
   */
  formatDateLong(date) {
    const d = new Date(date);
    const formatter = new global.Intl.DateTimeFormat(this.locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: this.dateConfig.timezone
    });
    return formatter.format(d);
  }

  /**
   * Formatea una fecha con opciones personalizadas
   *
   * @param {Date|string|number} date - Fecha a formatear
   * @param {Object} options - Opciones de formato de Intl.DateTimeFormat
   * @returns {string} Fecha formateada
   *
   * @example
   * intl.formatDate(new Date(), {
   *   weekday: 'long',
   *   year: 'numeric',
   *   month: 'long',
   *   day: 'numeric'
   * });
   * // "viernes, 31 de octubre de 2025"
   */
  formatDate(date, options = {}) {
    const d = new Date(date);
    const formatter = new global.Intl.DateTimeFormat(this.locale, {
      timeZone: this.dateConfig.timezone,
      ...options
    });
    return formatter.format(d);
  }

  /**
   * Obtiene el separador decimal según el locale configurado
   *
   * @returns {string} Separador decimal ('.' o ',')
   *
   * @example
   * intl.getDecimalSeparator(); // "," para es-CL, "." para en-US
   */
  getDecimalSeparator() {
    const formatter = new global.Intl.NumberFormat(this.locale);
    const parts = formatter.formatToParts(1.1);
    const decimalPart = parts.find(part => part.type === 'decimal');
    return decimalPart ? decimalPart.value : '.';
  }

  /**
   * Obtiene el separador de miles según el locale configurado
   *
   * @returns {string} Separador de miles (',' o '.' o ' ')
   *
   * @example
   * intl.getThousandsSeparator(); // "." para es-CL, "," para en-US
   */
  getThousandsSeparator() {
    const formatter = new global.Intl.NumberFormat(this.locale, { useGrouping: true });
    const parts = formatter.formatToParts(1000);
    const groupPart = parts.find(part => part.type === 'group');
    return groupPart ? groupPart.value : ',';
  }

  /**
   * Parsea un valor de moneda formateado a número
   *
   * @param {string} formattedValue - Valor formateado (ej: "$1.500")
   * @returns {number} Valor numérico
   *
   * @example
   * intl.parseCurrency("$1.500"); // 1500
   * intl.parseCurrency("$1.500,50"); // 1500.5
   */
  parseCurrency(formattedValue) {
    if (typeof formattedValue !== 'string') {
      return parseFloat(formattedValue) || 0;
    }

    // Obtener separadores según configuración
    const decimalSep = this.getDecimalSeparator();
    const thousandsSep = this.getThousandsSeparator();

    // Remover símbolo de moneda y espacios
    let cleaned = formattedValue.replace(/[^\d,.-]/g, '');

    // Reemplazar separadores según la configuración del locale
    // Primero eliminar el separador de miles
    cleaned = cleaned.split(thousandsSep).join('');
    // Luego reemplazar el separador decimal por punto (estándar JS)
    cleaned = cleaned.replace(decimalSep, '.');

    return parseFloat(cleaned) || 0;
  }

  /**
   * Parsea un valor numérico formateado a número
   *
   * @param {string} formattedValue - Valor formateado (ej: "1.500,75")
   * @returns {number} Valor numérico
   *
   * @example
   * intl.parseNumber("1.500"); // 1500
   * intl.parseNumber("1.500,75"); // 1500.75
   */
  parseNumber(formattedValue) {
    if (typeof formattedValue !== 'string') {
      return parseFloat(formattedValue) || 0;
    }

    // Obtener separadores según configuración
    const decimalSep = this.getDecimalSeparator();
    const thousandsSep = this.getThousandsSeparator();

    let cleaned = formattedValue.trim();

    // Reemplazar separadores según la configuración del locale
    // Primero eliminar el separador de miles
    cleaned = cleaned.split(thousandsSep).join('');
    // Luego reemplazar el separador decimal por punto (estándar JS)
    cleaned = cleaned.replace(decimalSep, '.');

    return parseFloat(cleaned) || 0;
  }
}
