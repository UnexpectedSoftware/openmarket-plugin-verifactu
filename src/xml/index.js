'use strict';

const {TIPO_HUELLA, hashRegistroAlta, hashRegistroAnulacion} = require('../hash');

const NS = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
const AMOUNT = /^-?\d+\.\d{2}$/;
const EXPEDITION_DATE = /^\d{2}-\d{2}-\d{4}$/;
const ISSUE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const SHA256 = /^[0-9A-F]{64}$/;
const EXEMPT = new Set(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
const NOT_SUBJECT = new Set(['N1', 'N2']);

/**
 * One VAT breakdown row from an InvoiceIssued payload. Amounts are integer cents.
 * @typedef {object} VatBreakdownRow
 * @property {string} kind `S1`, `E`, or `N`
 * @property {number} percent
 * @property {string|null} cause
 * @property {number} baseCents
 * @property {number} quotaCents
 */

/**
 * The previous registration, already in the lexical form written into RegistroAnterior.
 * @typedef {object} RegistroAnterior
 * @property {string} idEmisorFactura
 * @property {string} numSerieFactura
 * @property {string} fechaExpedicionFactura `DD-MM-YYYY`
 * @property {string} huella
 */

/**
 * SistemaInformatico block. Not part of the hash.
 * @typedef {object} SistemaInformatico
 * @property {string} nombreRazon
 * @property {string} nif
 * @property {string} nombreSistemaInformatico
 * @property {string} idSistemaInformatico
 * @property {string} version
 * @property {string} numeroInstalacion
 * @property {'S'|'N'} tipoUsoPosibleSoloVerifactu
 * @property {'S'|'N'} tipoUsoPosibleMultiOT
 * @property {'S'|'N'} indicadorMultiplesOT
 */

/**
 * @typedef {object} AltaXml
 * @property {string} idEmisorFactura
 * @property {string} numSerieFactura
 * @property {string} fechaExpedicionFactura `DD-MM-YYYY`
 * @property {string} tipoFactura
 * @property {string} cuotaTotal two decimal places
 * @property {string} importeTotal two decimal places
 * @property {string} fechaHoraHusoGenRegistro
 * @property {string} hash SHA-256 of those fields; must match src/hash
 * @property {string} nombreRazonEmisor
 * @property {string} descripcionOperacion
 * @property {string} refExterna
 * @property {VatBreakdownRow[]} breakdown
 * @property {RegistroAnterior|null} previous
 * @property {SistemaInformatico} software
 */

/**
 * @typedef {object} AnulacionXml
 * @property {string} idEmisorFacturaAnulada
 * @property {string} numSerieFacturaAnulada
 * @property {string} fechaExpedicionFacturaAnulada `DD-MM-YYYY`
 * @property {string} fechaHoraHusoGenRegistro
 * @property {string} hash
 * @property {string} refExterna
 * @property {RegistroAnterior|null} previous
 * @property {SistemaInformatico} software
 */

/**
 * Integer cents as a two-decimal euro amount. `838` is `8.38`, `1235` is `12.35`.
 * @param {number} cents
 * @returns {string}
 */
function formatAmount(cents) {
  if (typeof cents !== 'number' || !Number.isInteger(cents)) {
    throw new Error('verifactu: amount must be integer cents');
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * `YYYY-MM-DD` to the AEAT expedition date `DD-MM-YYYY`, without using `Date`.
 * @param {string} issueDate
 * @returns {string}
 */
function formatExpeditionDate(issueDate) {
  if (typeof issueDate !== 'string') {
    throw new Error('verifactu: issueDate must be YYYY-MM-DD');
  }
  const match = ISSUE_DATE.exec(issueDate);
  if (!match) throw new Error('verifactu: issueDate must be YYYY-MM-DD');
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Generation timestamp as the payload provides it: seconds and a numeric offset, no `Z`.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireTimestamp(value, field) {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    throw new Error(`verifactu: ${field} must be YYYY-MM-DDTHH:MM:SS±HH:MM`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function requireText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`verifactu: ${field} is required`);
  }
  if (value.length > max) throw new Error(`verifactu: ${field} is too long`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNif(value, field) {
  const nif = requireText(value, field, 9);
  if (nif.length !== 9) throw new Error(`verifactu: ${field} must be 9 characters`);
  return nif;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireAmount(value, field) {
  if (typeof value !== 'string' || !AMOUNT.test(value)) {
    throw new Error(`verifactu: ${field} must be a decimal amount with two places`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireExpeditionDate(value, field) {
  if (typeof value !== 'string' || !EXPEDITION_DATE.test(value)) {
    throw new Error(`verifactu: ${field} must be DD-MM-YYYY`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireHash(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`verifactu: ${field} must be a SHA-256 hash`);
  }
  return value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * @param {string} name
 * @param {string | string[]} content
 * @returns {string}
 */
function element(name, content) {
  if (typeof content === 'string') return `<sf:${name}>${escapeText(content)}</sf:${name}>`;
  const inner = content.join('\n').split('\n').map(line => `  ${line}`).join('\n');
  return `<sf:${name}>\n${inner}\n</sf:${name}>`;
}

/**
 * @param {string} name
 * @param {string[]} children
 * @returns {string}
 */
function documentElement(name, children) {
  const inner = children.join('\n').split('\n').map(line => `  ${line}`).join('\n');
  return `<sf:${name} xmlns:sf="${NS}">\n${inner}\n</sf:${name}>`;
}

/**
 * @param {VatBreakdownRow} row
 * @returns {string}
 */
function detalleDesglose(row) {
  if (!row || typeof row !== 'object') throw new Error('verifactu: vatBreakdown row is required');
  const base = formatAmount(row.baseCents);
  const head = [element('Impuesto', '01'), element('ClaveRegimen', '01')];
  if (row.kind === 'S1') {
    if (row.cause != null) throw new Error('verifactu: a taxed VAT row cannot have a cause');
    if (!Number.isInteger(row.percent) || row.percent < 0 || row.percent > 999) {
      throw new Error('verifactu: VAT percent must be an integer');
    }
    return element('DetalleDesglose', [
      ...head,
      element('CalificacionOperacion', 'S1'),
      element('TipoImpositivo', String(row.percent)),
      element('BaseImponibleOimporteNoSujeto', base),
      element('CuotaRepercutida', formatAmount(row.quotaCents)),
    ]);
  }
  if (row.kind === 'E') {
    if (typeof row.cause !== 'string' || !EXEMPT.has(row.cause)) {
      throw new Error('verifactu: exempt VAT cause must be E1 to E6');
    }
    if (row.quotaCents !== 0) throw new Error('verifactu: exempt VAT row cannot have a quota');
    return element('DetalleDesglose', [
      ...head,
      element('OperacionExenta', row.cause),
      element('BaseImponibleOimporteNoSujeto', base),
    ]);
  }
  if (row.kind === 'N') {
    if (typeof row.cause !== 'string' || !NOT_SUBJECT.has(row.cause)) {
      throw new Error('verifactu: not-subject VAT cause must be N1 or N2');
    }
    if (row.quotaCents !== 0) throw new Error('verifactu: not-subject VAT row cannot have a quota');
    return element('DetalleDesglose', [
      ...head,
      element('CalificacionOperacion', row.cause),
      element('BaseImponibleOimporteNoSujeto', base),
    ]);
  }
  throw new Error(`verifactu: unsupported VAT kind ${String(row.kind)}`);
}

/**
 * @param {SistemaInformatico} software
 * @returns {string}
 */
function sistemaInformatico(software) {
  if (!software || typeof software !== 'object') throw new Error('verifactu: software identity is required');
  const solo = software.tipoUsoPosibleSoloVerifactu;
  const multi = software.tipoUsoPosibleMultiOT;
  const indicador = software.indicadorMultiplesOT;
  if (solo !== 'S' && solo !== 'N') throw new Error('verifactu: TipoUsoPosibleSoloVerifactu must be S or N');
  if (multi !== 'S' && multi !== 'N') throw new Error('verifactu: TipoUsoPosibleMultiOT must be S or N');
  if (indicador !== 'S' && indicador !== 'N') throw new Error('verifactu: IndicadorMultiplesOT must be S or N');
  return element('SistemaInformatico', [
    element('NombreRazon', requireText(software.nombreRazon, 'NombreRazon', 120)),
    element('NIF', requireNif(software.nif, 'NIF')),
    element('NombreSistemaInformatico', requireText(software.nombreSistemaInformatico, 'NombreSistemaInformatico', 30)),
    element('IdSistemaInformatico', requireText(software.idSistemaInformatico, 'IdSistemaInformatico', 2)),
    element('Version', requireText(software.version, 'Version', 50)),
    element('NumeroInstalacion', requireText(software.numeroInstalacion, 'NumeroInstalacion', 100)),
    element('TipoUsoPosibleSoloVerifactu', solo),
    element('TipoUsoPosibleMultiOT', multi),
    element('IndicadorMultiplesOT', indicador),
  ]);
}

/**
 * @param {RegistroAnterior|null|undefined} previous
 * @returns {string}
 */
function encadenamiento(previous) {
  if (previous == null) return element('Encadenamiento', [element('PrimerRegistro', 'S')]);
  return element('Encadenamiento', [
    element('RegistroAnterior', [
      element('IDEmisorFactura', requireNif(previous.idEmisorFactura, 'IDEmisorFactura')),
      element('NumSerieFactura', requireText(previous.numSerieFactura, 'NumSerieFactura', 60)),
      element('FechaExpedicionFactura', requireExpeditionDate(previous.fechaExpedicionFactura, 'FechaExpedicionFactura')),
      element('Huella', requireHash(previous.huella, 'previous hash')),
    ]),
  ]);
}

/**
 * RegistroAlta element. The hashed text nodes are the strings in `input`; `hash` must be their SHA-256.
 * @param {AltaXml} input
 * @returns {string}
 */
function buildRegistroAlta(input) {
  if (!input || typeof input !== 'object') throw new Error('verifactu: registration is required');
  if (!Array.isArray(input.breakdown) || input.breakdown.length === 0) {
    throw new Error('verifactu: vatBreakdown is required');
  }
  if (input.breakdown.length > 12) throw new Error('verifactu: vatBreakdown has more than 12 rates');
  const desglose = input.breakdown.map(detalleDesglose);
  const fields = {
    idEmisorFactura: requireNif(input.idEmisorFactura, 'IDEmisorFactura'),
    numSerieFactura: requireText(input.numSerieFactura, 'NumSerieFactura', 60),
    fechaExpedicionFactura: requireExpeditionDate(input.fechaExpedicionFactura, 'FechaExpedicionFactura'),
    tipoFactura: requireText(input.tipoFactura, 'TipoFactura', 2),
    cuotaTotal: requireAmount(input.cuotaTotal, 'CuotaTotal'),
    importeTotal: requireAmount(input.importeTotal, 'ImporteTotal'),
    huella: input.previous == null ? null : requireHash(input.previous.huella, 'previous hash'),
    fechaHoraHusoGenRegistro: requireTimestamp(input.fechaHoraHusoGenRegistro, 'FechaHoraHusoGenRegistro'),
  };
  const hash = hashRegistroAlta(fields);
  if (input.hash !== hash) throw new Error('verifactu: registration hash does not match its fields');
  return documentElement('RegistroAlta', [
    element('IDVersion', '1.0'),
    element('IDFactura', [
      element('IDEmisorFactura', fields.idEmisorFactura),
      element('NumSerieFactura', fields.numSerieFactura),
      element('FechaExpedicionFactura', fields.fechaExpedicionFactura),
    ]),
    element('RefExterna', requireText(input.refExterna, 'RefExterna', 60)),
    element('NombreRazonEmisor', requireText(input.nombreRazonEmisor, 'NombreRazonEmisor', 120)),
    element('TipoFactura', fields.tipoFactura),
    element('DescripcionOperacion', requireText(input.descripcionOperacion, 'DescripcionOperacion', 500)),
    element('Desglose', desglose),
    element('CuotaTotal', fields.cuotaTotal),
    element('ImporteTotal', fields.importeTotal),
    encadenamiento(input.previous),
    sistemaInformatico(input.software),
    element('FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro),
    element('TipoHuella', TIPO_HUELLA),
    element('Huella', hash),
  ]);
}

/**
 * RegistroAnulacion element. Same hash rule as {@link buildRegistroAlta}.
 * @param {AnulacionXml} input
 * @returns {string}
 */
function buildRegistroAnulacion(input) {
  if (!input || typeof input !== 'object') throw new Error('verifactu: registration is required');
  const fields = {
    idEmisorFacturaAnulada: requireNif(input.idEmisorFacturaAnulada, 'IDEmisorFacturaAnulada'),
    numSerieFacturaAnulada: requireText(input.numSerieFacturaAnulada, 'NumSerieFacturaAnulada', 60),
    fechaExpedicionFacturaAnulada: requireExpeditionDate(input.fechaExpedicionFacturaAnulada, 'FechaExpedicionFacturaAnulada'),
    huella: input.previous == null ? null : requireHash(input.previous.huella, 'previous hash'),
    fechaHoraHusoGenRegistro: requireTimestamp(input.fechaHoraHusoGenRegistro, 'FechaHoraHusoGenRegistro'),
  };
  const hash = hashRegistroAnulacion(fields);
  if (input.hash !== hash) throw new Error('verifactu: registration hash does not match its fields');
  return documentElement('RegistroAnulacion', [
    element('IDVersion', '1.0'),
    element('IDFactura', [
      element('IDEmisorFacturaAnulada', fields.idEmisorFacturaAnulada),
      element('NumSerieFacturaAnulada', fields.numSerieFacturaAnulada),
      element('FechaExpedicionFacturaAnulada', fields.fechaExpedicionFacturaAnulada),
    ]),
    element('RefExterna', requireText(input.refExterna, 'RefExterna', 60)),
    encadenamiento(input.previous),
    sistemaInformatico(input.software),
    element('FechaHoraHusoGenRegistro', fields.fechaHoraHusoGenRegistro),
    element('TipoHuella', TIPO_HUELLA),
    element('Huella', hash),
  ]);
}

module.exports = {
  formatAmount,
  formatExpeditionDate,
  requireTimestamp,
  buildRegistroAlta,
  buildRegistroAnulacion,
};
