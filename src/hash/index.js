'use strict';

const {createHash} = require('node:crypto');

/**
 * Lista L12: the only permitted algorithm (SHA-256). Not part of the hashed string;
 * phase 3 writes it in the registration XML as TipoHuella.
 */
const TIPO_HUELLA = '01';

/**
 * Fields of a RegistroAlta, already in the lexical form that will be written in the XML.
 * Amounts are not reformatted here: `12.35` and `12.350` hash differently.
 * @typedef {object} AltaHashFields
 * @property {string} idEmisorFactura
 * @property {string} numSerieFactura
 * @property {string} fechaExpedicionFactura `DD-MM-YYYY`
 * @property {string} tipoFactura
 * @property {string} cuotaTotal
 * @property {string} importeTotal
 * @property {string|null} [huella] previous registration hash; empty for the first record
 * @property {string} fechaHoraHusoGenRegistro `YYYY-MM-DDTHH:MM:SS±HH:MM`
 */

/**
 * Fields of a RegistroAnulacion, same lexical-form rule as {@link AltaHashFields}.
 * @typedef {object} AnulacionHashFields
 * @property {string} idEmisorFacturaAnulada
 * @property {string} numSerieFacturaAnulada
 * @property {string} fechaExpedicionFacturaAnulada `DD-MM-YYYY`
 * @property {string|null} [huella] previous registration hash; empty for the first record
 * @property {string} fechaHoraHusoGenRegistro `YYYY-MM-DDTHH:MM:SS±HH:MM`
 */

/**
 * Java `String.trim()`: drop code points `<= U+0020` from both ends. Interior spaces stay.
 * `String.prototype.trim()` would also drop NBSP and other Unicode spaces, which the AEAT
 * reference implementation keeps.
 * @param {string} value
 * @returns {string}
 */
function trimJava(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

/**
 * @param {unknown} fields
 */
function requireFields(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('verifactu: hash fields are required');
  }
}

/**
 * One `name=value` pair. A missing Huella is `Huella=` with nothing after the equals.
 * @param {string} name
 * @param {string|null|undefined} value
 * @param {boolean} required
 * @returns {string}
 */
function pair(name, value, required) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return `${name}=`;
    throw new Error(value == null
      ? `verifactu: hash field ${name} is required`
      : `verifactu: hash field ${name} must be a string`);
  }
  const trimmed = trimJava(value);
  if (trimmed === '') {
    if (!required) return `${name}=`;
    throw new Error(`verifactu: hash field ${name} is required`);
  }
  return `${name}=${trimmed}`;
}

/**
 * Canonical input of a RegistroAlta hash (AEAT huella spec v0.1.2).
 * @param {AltaHashFields} fields
 * @returns {string}
 */
function registroAltaInput(fields) {
  requireFields(fields);
  return [
    pair('IDEmisorFactura', fields.idEmisorFactura, true),
    pair('NumSerieFactura', fields.numSerieFactura, true),
    pair('FechaExpedicionFactura', fields.fechaExpedicionFactura, true),
    pair('TipoFactura', fields.tipoFactura, true),
    pair('CuotaTotal', fields.cuotaTotal, true),
    pair('ImporteTotal', fields.importeTotal, true),
    pair('Huella', fields.huella, false),
    pair('FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro, true),
  ].join('&');
}

/**
 * Canonical input of a RegistroAnulacion hash (AEAT huella spec v0.1.2).
 * @param {AnulacionHashFields} fields
 * @returns {string}
 */
function registroAnulacionInput(fields) {
  requireFields(fields);
  return [
    pair('IDEmisorFacturaAnulada', fields.idEmisorFacturaAnulada, true),
    pair('NumSerieFacturaAnulada', fields.numSerieFacturaAnulada, true),
    pair('FechaExpedicionFacturaAnulada', fields.fechaExpedicionFacturaAnulada, true),
    pair('Huella', fields.huella, false),
    pair('FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro, true),
  ].join('&');
}

/**
 * SHA-256 of `input` as 64 uppercase hex characters.
 * @param {string} input
 * @returns {string}
 */
function sha256Upper(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase();
}

/**
 * @param {AltaHashFields} fields
 * @returns {string}
 */
function hashRegistroAlta(fields) {
  return sha256Upper(registroAltaInput(fields));
}

/**
 * @param {AnulacionHashFields} fields
 * @returns {string}
 */
function hashRegistroAnulacion(fields) {
  return sha256Upper(registroAnulacionInput(fields));
}

module.exports = {
  TIPO_HUELLA,
  registroAltaInput,
  hashRegistroAlta,
  registroAnulacionInput,
  hashRegistroAnulacion,
};
