'use strict';

const {hashRegistroAlta, hashRegistroAnulacion} = require('../hash');
const {
  buildRegistroAlta,
  buildRegistroAnulacion,
  formatAmount,
  formatExpeditionDate,
  requireTimestamp,
} = require('../xml');

const plugin = /** @type {{version: string}} */ (require('../../plugin.json'));

/** Durable subscriber name. The loader requires the plugin id prefix. */
const SEND_SUBSCRIBER = 'verifactu:send';
const SOFTWARE_NAME = 'OpenMarket';
const DEFAULT_SOFTWARE_ID = 'OM';
const INSTALLATION_NUMBER = '1';

/**
 * @typedef {object} Issuer
 * @property {string} nif
 * @property {string} legalName
 * @property {{country?: string}|null|undefined} [address]
 */

/**
 * @typedef {object} VatRow
 * @property {string} kind
 * @property {number} percent
 * @property {string|null} cause
 * @property {number} baseCents
 * @property {number} quotaCents
 * @property {number} grossCents
 */

/**
 * @typedef {object} IssuedPayload
 * @property {string} type
 * @property {string} invoiceId
 * @property {string} invoiceNumber
 * @property {string} issueDate
 * @property {string} issuedAt
 * @property {Issuer|null} issuer
 * @property {{name?: string}[]} lines
 * @property {VatRow[]} vatBreakdown
 * @property {number} totalCents
 * @property {number} vatTotalCents
 */

/**
 * @typedef {object} CancelledPayload
 * @property {string} type
 * @property {string} invoiceId
 * @property {string} invoiceNumber
 * @property {string} issueDate
 * @property {string} cancelledAt
 * @property {Issuer|null} issuer
 */

/**
 * @typedef {import('../xml').RegistroAnterior} ChainLink
 */

/**
 * @typedef {object} Statements
 * @property {import('node:sqlite').StatementSync} last
 * @property {import('node:sqlite').StatementSync} byKind
 * @property {import('node:sqlite').StatementSync} insert
 */

/**
 * @param {object|null|undefined} event
 */
function requireSchema(event) {
  const version = event && /** @type {{schemaVersion?: number}} */ (event).schemaVersion;
  if (version !== 1) {
    throw new Error(`verifactu: unsupported invoice payload schemaVersion ${String(version)}`);
  }
}

/**
 * @param {{type?: unknown}} payload
 */
function requireSimplified(payload) {
  if (payload.type !== 'F2') {
    throw new Error(`verifactu: unsupported invoice type ${String(payload.type)}`);
  }
}

/**
 * @param {{issuer?: Issuer|null}} payload
 * @param {Record<string, string>} config
 * @returns {Issuer}
 */
function requireIssuer(payload, config) {
  const issuer = payload.issuer;
  if (!issuer || typeof issuer.nif !== 'string' || typeof issuer.legalName !== 'string') {
    throw new Error('verifactu: issuer is required');
  }
  if (issuer.nif.length !== 9) throw new Error('verifactu: issuer NIF must be 9 characters');
  if (issuer.legalName.trim() === '') throw new Error('verifactu: issuer legal name is required');
  if (issuer.legalName.length > 120) throw new Error('verifactu: issuer legal name is too long');
  const country = issuer.address && issuer.address.country;
  if (country !== 'ES') throw new Error('verifactu: issuer country must be ES');
  const configured = typeof config.nif === 'string' ? config.nif.trim() : '';
  if (configured !== '' && configured !== issuer.nif) {
    throw new Error('verifactu: configured NIF does not match the invoice issuer');
  }
  return issuer;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireIdentifier(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`verifactu: ${field} is required`);
  if (value.length > 60) throw new Error(`verifactu: ${field} is too long`);
  return value;
}

/**
 * @param {unknown} lines
 * @returns {string}
 */
function describeLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('verifactu: invoice lines are required');
  const names = lines.map((line, index) => {
    const name = line && typeof line.name === 'string' ? line.name : '';
    if (name.trim() === '') throw new Error(`verifactu: invoice line ${index} name is required`);
    return name;
  });
  const text = names.join(', ');
  return text.length > 500 ? text.slice(0, 500) : text;
}

/**
 * @param {IssuedPayload} payload
 * @returns {VatRow[]}
 */
function requireBreakdown(payload) {
  const rows = payload.vatBreakdown;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('verifactu: vatBreakdown is required');
  let quota = 0;
  let gross = 0;
  for (const row of rows) {
    if (!row || !Number.isInteger(row.baseCents) || !Number.isInteger(row.quotaCents) || !Number.isInteger(row.grossCents)) {
      throw new Error('verifactu: vatBreakdown row is incomplete');
    }
    quota += row.quotaCents;
    gross += row.grossCents;
  }
  if (!Number.isInteger(payload.vatTotalCents) || !Number.isInteger(payload.totalCents) || quota !== payload.vatTotalCents || gross !== payload.totalCents) {
    throw new Error('verifactu: vatBreakdown does not add up to the invoice totals');
  }
  return rows;
}

/**
 * @param {Issuer} issuer
 * @param {Record<string, string>} config
 * @returns {import('../xml').SistemaInformatico}
 */
function softwareIdentity(issuer, config) {
  const configured = typeof config.softwareId === 'string' ? config.softwareId.trim() : '';
  if (configured.length > 2) throw new Error('verifactu: softwareId must be 1 or 2 characters');
  return {
    nombreRazon: issuer.legalName,
    nif: issuer.nif,
    nombreSistemaInformatico: SOFTWARE_NAME,
    idSistemaInformatico: configured === '' ? DEFAULT_SOFTWARE_ID : configured,
    version: plugin.version,
    numeroInstalacion: INSTALLATION_NUMBER,
    tipoUsoPosibleSoloVerifactu: 'S',
    tipoUsoPosibleMultiOT: 'N',
    indicadorMultiplesOT: 'N',
  };
}

/**
 * @param {import('node:sqlite').StatementSync} last
 * @returns {ChainLink|null}
 */
function previousLink(last) {
  const row = /** @type {{issuer_nif: string, invoice_number: string, expedition_date: string, hash: string}|undefined} */ (
    last.get());
  if (!row) return null;
  if (row.issuer_nif === '') {
    throw new Error('verifactu: the previous registration has no issuer NIF, so the chain cannot continue');
  }
  if (!/^\d{2}-\d{2}-\d{4}$/.test(row.expedition_date)) {
    throw new Error('verifactu: the previous registration has no expedition date, so the chain cannot continue');
  }
  if (typeof row.invoice_number !== 'string' || row.invoice_number === '') {
    throw new Error('verifactu: the previous registration has no invoice number, so the chain cannot continue');
  }
  if (!/^[0-9A-F]{64}$/.test(row.hash)) {
    throw new Error('verifactu: the previous registration hash is not a SHA-256');
  }
  return {
    idEmisorFactura: row.issuer_nif,
    numSerieFactura: row.invoice_number,
    fechaExpedicionFactura: row.expedition_date,
    huella: row.hash,
  };
}

/**
 * @param {import('node:sqlite').StatementSync} byKind
 * @param {string} invoiceId
 * @param {'ALTA'|'ANULACION'} kind
 */
function assertNotRegistered(byKind, invoiceId, kind) {
  if (byKind.get(invoiceId, kind)) {
    throw new Error(`verifactu: invoice ${invoiceId} already has an ${kind} registration`);
  }
}

/**
 * @param {import('node:sqlite').StatementSync} byKind
 * @param {string} invoiceId
 */
function assertAltaExists(byKind, invoiceId) {
  if (!byKind.get(invoiceId, 'ALTA')) {
    throw new Error(`verifactu: invoice ${invoiceId} has no ALTA registration`);
  }
}

/**
 * @param {Statements} statements
 * @param {{id: string, invoiceId: string, invoiceNumber: string, kind: 'ALTA'|'ANULACION', nif: string, expeditionDate: string, previous: ChainLink|null, hash: string, xml: string, createdAt: string}} row
 */
function insertRegistration(statements, row) {
  statements.insert.run(
    row.id,
    row.invoiceId,
    row.invoiceNumber,
    row.kind,
    row.nif,
    row.expeditionDate,
    row.previous ? row.previous.huella : null,
    row.hash,
    row.xml,
    row.createdAt
  );
}

/**
 * @param {Record<string, string>} config
 * @param {Statements} statements
 * @param {object} event
 */
function onIssued(config, statements, event) {
  requireSchema(event);
  const payload = /** @type {IssuedPayload} */ (event);
  requireSimplified(payload);
  const issuer = requireIssuer(payload, config);
  const invoiceId = requireIdentifier(payload.invoiceId, 'invoiceId');
  const invoiceNumber = requireIdentifier(payload.invoiceNumber, 'invoiceNumber');
  const expeditionDate = formatExpeditionDate(payload.issueDate);
  const issuedAt = requireTimestamp(payload.issuedAt, 'issuedAt');
  const descripcion = describeLines(payload.lines);
  const breakdown = requireBreakdown(payload);
  const software = softwareIdentity(issuer, config);
  assertNotRegistered(statements.byKind, invoiceId, 'ALTA');
  const previous = previousLink(statements.last);
  const fields = {
    idEmisorFactura: issuer.nif,
    numSerieFactura: invoiceNumber,
    fechaExpedicionFactura: expeditionDate,
    tipoFactura: 'F2',
    cuotaTotal: formatAmount(payload.vatTotalCents),
    importeTotal: formatAmount(payload.totalCents),
    huella: previous ? previous.huella : null,
    fechaHoraHusoGenRegistro: issuedAt,
  };
  const hash = hashRegistroAlta(fields);
  const xml = buildRegistroAlta({
    idEmisorFactura: fields.idEmisorFactura,
    numSerieFactura: fields.numSerieFactura,
    fechaExpedicionFactura: fields.fechaExpedicionFactura,
    tipoFactura: fields.tipoFactura,
    cuotaTotal: fields.cuotaTotal,
    importeTotal: fields.importeTotal,
    fechaHoraHusoGenRegistro: fields.fechaHoraHusoGenRegistro,
    hash,
    nombreRazonEmisor: issuer.legalName,
    descripcionOperacion: descripcion,
    refExterna: invoiceId,
    breakdown,
    previous,
    software,
  });
  insertRegistration(statements, {
    id: `${invoiceId}:ALTA`,
    invoiceId,
    invoiceNumber,
    kind: 'ALTA',
    nif: issuer.nif,
    expeditionDate,
    previous,
    hash,
    xml,
    createdAt: issuedAt,
  });
}

/**
 * @param {Record<string, string>} config
 * @param {Statements} statements
 * @param {object} event
 */
function onCancelled(config, statements, event) {
  requireSchema(event);
  const payload = /** @type {CancelledPayload} */ (event);
  requireSimplified(payload);
  const issuer = requireIssuer(payload, config);
  const invoiceId = requireIdentifier(payload.invoiceId, 'invoiceId');
  const invoiceNumber = requireIdentifier(payload.invoiceNumber, 'invoiceNumber');
  const expeditionDate = formatExpeditionDate(payload.issueDate);
  const cancelledAt = requireTimestamp(payload.cancelledAt, 'cancelledAt');
  const software = softwareIdentity(issuer, config);
  assertAltaExists(statements.byKind, invoiceId);
  assertNotRegistered(statements.byKind, invoiceId, 'ANULACION');
  const previous = previousLink(statements.last);
  const fields = {
    idEmisorFacturaAnulada: issuer.nif,
    numSerieFacturaAnulada: invoiceNumber,
    fechaExpedicionFacturaAnulada: expeditionDate,
    huella: previous ? previous.huella : null,
    fechaHoraHusoGenRegistro: cancelledAt,
  };
  const hash = hashRegistroAnulacion(fields);
  const xml = buildRegistroAnulacion({
    idEmisorFacturaAnulada: fields.idEmisorFacturaAnulada,
    numSerieFacturaAnulada: fields.numSerieFacturaAnulada,
    fechaExpedicionFacturaAnulada: fields.fechaExpedicionFacturaAnulada,
    fechaHoraHusoGenRegistro: fields.fechaHoraHusoGenRegistro,
    hash,
    refExterna: invoiceId,
    previous,
    software,
  });
  insertRegistration(statements, {
    id: `${invoiceId}:ANULACION`,
    invoiceId,
    invoiceNumber,
    kind: 'ANULACION',
    nif: issuer.nif,
    expeditionDate,
    previous,
    hash,
    xml,
    createdAt: cancelledAt,
  });
}

/**
 * Registers the plugin's subscribers.
 * Sync handlers hash and insert a PENDING_SEND row inside the sale transaction.
 * The durable sender stays a stub until phase 4.
 * @param {{eventBus: import('../../index').PluginEventBus, events: Record<string, Function>, database: import('node:sqlite').DatabaseSync, config: Record<string, string>}} deps
 */
function registerSubscribers({eventBus, events, database, config}) {
  const settings = config || {};
  /** @type {Statements} */
  const statements = {
    last: database.prepare(`
      SELECT issuer_nif, invoice_number, expedition_date, hash
      FROM verifactu_registration
      ORDER BY seq DESC
      LIMIT 1
    `),
    byKind: database.prepare('SELECT id FROM verifactu_registration WHERE invoice_id = ? AND kind = ?'),
    insert: database.prepare(`
      INSERT INTO verifactu_registration (
        id, invoice_id, invoice_number, kind, issuer_nif, expedition_date,
        previous_hash, hash, xml, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_SEND', ?)
    `),
  };
  eventBus.subscribeSync(events.InvoiceIssued, event => onIssued(settings, statements, event));
  eventBus.subscribeSync(events.InvoiceCancelled, event => onCancelled(settings, statements, event));
  eventBus.subscribeDurable(SEND_SUBSCRIBER, events.InvoiceIssued, () => {
    // TODO(phase 4): send PENDING_SEND registrations to AEAT (mTLS), idempotent by invoice_id and kind.
  });
  eventBus.subscribeDurable(`${SEND_SUBSCRIBER}-cancellation`, events.InvoiceCancelled, () => {
    // TODO(phase 4): send ANULACION registrations.
  });
}

module.exports = {registerSubscribers, SEND_SUBSCRIBER};
