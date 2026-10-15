'use strict';

/** Current schema version of the verifactu_* tables. */
const SCHEMA_VERSION = 1;

/** Columns a registration may change after insert (delivery state only). */
const DELIVERY_COLUMNS = ['status', 'attempts', 'last_error', 'aeat_csv', 'sent_at'];
const IMMUTABLE_COLUMNS = ['seq', 'id', 'invoice_id', 'invoice_number', 'kind', 'previous_hash', 'hash', 'xml', 'created_at'];

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
CREATE TRIGGER IF NOT EXISTS verifactu_registration_forbid_delete
BEFORE DELETE ON verifactu_registration
BEGIN
  SELECT RAISE(ABORT, 'verifactu_registration rows cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS verifactu_registration_forbid_rewrite
BEFORE UPDATE OF ${IMMUTABLE_COLUMNS.join(', ')} ON verifactu_registration
WHEN ${IMMUTABLE_COLUMNS.map(c => `NEW.${c} IS NOT OLD.${c}`).join(' OR ')}
BEGIN
  SELECT RAISE(ABORT, 'verifactu_registration rows are immutable except delivery fields');
END;
`;

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
    if (ownTransaction) database.exec('COMMIT');
  } catch (error) {
    if (ownTransaction) database.exec('ROLLBACK');
    throw error;
  }
  return SCHEMA_VERSION;
}

module.exports = {migrate, SCHEMA_VERSION, DELIVERY_COLUMNS, IMMUTABLE_COLUMNS};
