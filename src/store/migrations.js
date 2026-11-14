'use strict';

/** Current schema version of the verifactu_* tables. */
const SCHEMA_VERSION = 2;

/** Columns a registration may change after insert (delivery state only). */
const DELIVERY_COLUMNS = ['status', 'attempts', 'last_error', 'aeat_csv', 'sent_at'];
const IMMUTABLE_COLUMNS = [
  'seq', 'id', 'invoice_id', 'invoice_number', 'kind', 'issuer_nif', 'expedition_date',
  'previous_hash', 'hash', 'xml', 'created_at'
];

/**
 * Columns the 0.1.0 trigger protected. V1 is frozen: later columns are not added here,
 * because a database already at version 1 does not run this statement again.
 */
const V1_IMMUTABLE_COLUMNS = ['seq', 'id', 'invoice_id', 'invoice_number', 'kind', 'previous_hash', 'hash', 'xml', 'created_at'];

/**
 * Delete is forbidden. Immutable columns cannot change; delivery columns can.
 * @param {string[]} columns
 * @returns {string}
 */
function immutabilityTriggers(columns) {
  return `
CREATE TRIGGER IF NOT EXISTS verifactu_registration_forbid_delete
BEFORE DELETE ON verifactu_registration
BEGIN
  SELECT RAISE(ABORT, 'verifactu_registration rows cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS verifactu_registration_forbid_rewrite
BEFORE UPDATE OF ${columns.join(', ')} ON verifactu_registration
WHEN ${columns.map(column => `NEW.${column} IS NOT OLD.${column}`).join(' OR ')}
BEGIN
  SELECT RAISE(ABORT, 'verifactu_registration rows are immutable except delivery fields');
END;
`;
}

const V1 = `
CREATE TABLE IF NOT EXISTS verifactu_registration (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ALTA', 'ANULACION')),
  previous_hash TEXT,
  hash TEXT NOT NULL,
  xml TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_SEND', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  aeat_csv TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
${immutabilityTriggers(V1_IMMUTABLE_COLUMNS)}
`;

const V2_TABLE = `
CREATE TABLE verifactu_registration_v2 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ALTA', 'ANULACION')),
  issuer_nif TEXT NOT NULL,
  expedition_date TEXT NOT NULL,
  previous_hash TEXT,
  hash TEXT NOT NULL,
  xml TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_SEND', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  aeat_csv TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (invoice_id, kind)
);
`;

/**
 * Rebuilds the registration table. UNIQUE(invoice_id) could not store the anulación
 * of an invoice that already has an alta. issuer_nif and expedition_date are the
 * previous record's identity for Encadenamiento, copied in lexical form.
 * @param {import('node:sqlite').DatabaseSync} database
 */
function applyV2(database) {
  database.exec(V2_TABLE);
  database.exec(`
    INSERT INTO verifactu_registration_v2 (
      seq, id, invoice_id, invoice_number, kind, issuer_nif, expedition_date,
      previous_hash, hash, xml, status, attempts, last_error, aeat_csv, created_at, sent_at
    )
    SELECT
      seq, id, invoice_id, invoice_number, kind, '', '',
      previous_hash, hash, xml, status, attempts, last_error, aeat_csv, created_at, sent_at
    FROM verifactu_registration
  `);
  database.exec(`
    DROP TRIGGER IF EXISTS verifactu_registration_forbid_delete;
    DROP TRIGGER IF EXISTS verifactu_registration_forbid_rewrite;
    DROP TABLE verifactu_registration;
    ALTER TABLE verifactu_registration_v2 RENAME TO verifactu_registration;
  `);
  database.exec(immutabilityTriggers(IMMUTABLE_COLUMNS));
  database.prepare('INSERT INTO verifactu_schema_version (version) VALUES (?)').run(2);
}

/**
 * Creates or upgrades the plugin tables. Safe to call on every start.
 * @param {import('node:sqlite').DatabaseSync} database
 * @returns {number} the schema version after migrating
 */
function migrate(database) {
  database.exec('CREATE TABLE IF NOT EXISTS verifactu_schema_version (version INTEGER NOT NULL)');
  const row = /** @type {{version: number} | undefined} */ (
    database.prepare('SELECT MAX(version) AS version FROM verifactu_schema_version').get());
  const current = row && row.version != null ? Number(row.version) : 0;
  if (current >= SCHEMA_VERSION) {
    return current;
  }
  const ownTransaction = !database.isTransaction;
  if (ownTransaction) database.exec('BEGIN');
  try {
    if (current < 1) {
      database.exec(V1);
      database.prepare('INSERT INTO verifactu_schema_version (version) VALUES (?)').run(1);
    }
    if (current < 2) applyV2(database);
    if (ownTransaction) database.exec('COMMIT');
  } catch (error) {
    if (ownTransaction) database.exec('ROLLBACK');
    throw error;
  }
  return SCHEMA_VERSION;
}

module.exports = {migrate, SCHEMA_VERSION, DELIVERY_COLUMNS, IMMUTABLE_COLUMNS};
