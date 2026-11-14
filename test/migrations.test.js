'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {migrate, SCHEMA_VERSION} = require('../src/store/migrations');
const {fakeConnection} = require('./fakes');

/** @param {import('node:sqlite').DatabaseSync} db */
function insertRegistration(db) {
  db.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, previous_hash, hash, xml, status, created_at)
    VALUES ('r1', 'inv1', '2026/000001', 'ALTA', 'B12345674', '15-10-2026', NULL, 'abc', '<x/>', 'PENDING_SEND', '2026-10-15T10:00:00+02:00')`).run();
}

test('migrations are idempotent', () => {
  const {database} = fakeConnection();
  assert.equal(migrate(database), SCHEMA_VERSION);
  assert.equal(migrate(database), SCHEMA_VERSION);
  const rows = database.prepare('SELECT version FROM verifactu_schema_version ORDER BY version').all();
  assert.deepEqual(rows.map((/** @type {any} */ row) => row.version), [1, 2]);
  insertRegistration(database);
  migrate(database);
  assert.equal(/** @type {any} */ (database.prepare('SELECT COUNT(*) AS n FROM verifactu_registration').get()).n, 1);
});

test('migrations join an open transaction', () => {
  const {database} = fakeConnection();
  database.exec('BEGIN');
  migrate(database);
  database.exec('ROLLBACK');
  const table = database.prepare("SELECT name FROM sqlite_master WHERE name = 'verifactu_registration'").get();
  assert.equal(table, undefined);
});

test('one alta and one anulacion can share an invoice', () => {
  const {database} = fakeConnection();
  migrate(database);
  insertRegistration(database);
  database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, hash, xml, status, created_at)
    VALUES ('r2', 'inv1', '2026/000001', 'ANULACION', 'B12345674', '15-10-2026', 'def', '<y/>', 'PENDING_SEND', 'now')`).run();
  assert.throws(() => database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, hash, xml, status, created_at)
    VALUES ('r3', 'inv1', '2026/000001', 'ALTA', 'B12345674', '15-10-2026', 'ghi', '<z/>', 'PENDING_SEND', 'now')`).run(), /UNIQUE/);
  assert.throws(() => database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, hash, xml, status, created_at)
    VALUES ('r4', 'inv1', '2026/000001', 'ANULACION', 'B12345674', '15-10-2026', 'jkl', '<w/>', 'PENDING_SEND', 'now')`).run(), /UNIQUE/);
});

test('triggers reject delete and rewriting the hash', () => {
  const {database} = fakeConnection();
  migrate(database);
  insertRegistration(database);
  assert.throws(() => database.exec("DELETE FROM verifactu_registration WHERE id = 'r1'"), /cannot be deleted/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET hash = 'zzz' WHERE id = 'r1'"), /immutable/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET xml = '<y/>' WHERE id = 'r1'"), /immutable/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET issuer_nif = 'B00000000' WHERE id = 'r1'"), /immutable/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET expedition_date = '01-01-2020' WHERE id = 'r1'"), /immutable/);
});

test('a version 1 registration survives the rebuild', () => {
  const {database} = fakeConnection();
  database.exec(`
    CREATE TABLE verifactu_schema_version (version INTEGER NOT NULL);
    INSERT INTO verifactu_schema_version (version) VALUES (1);
    CREATE TABLE verifactu_registration (
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
    CREATE TRIGGER verifactu_registration_forbid_delete
    BEFORE DELETE ON verifactu_registration
    BEGIN
      SELECT RAISE(ABORT, 'verifactu_registration rows cannot be deleted');
    END;
    INSERT INTO verifactu_registration
      (id, invoice_id, invoice_number, kind, previous_hash, hash, xml, status, attempts, created_at)
      VALUES ('r1', 'inv1', '2026/000001', 'ALTA', NULL, 'abc', '<x/>', 'PENDING_SEND', 2, '2026-10-15T10:00:00+02:00');
  `);
  assert.equal(migrate(database), SCHEMA_VERSION);
  const row = /** @type {any} */ (database.prepare('SELECT * FROM verifactu_registration WHERE id = ?').get('r1'));
  assert.equal(row.invoice_id, 'inv1');
  assert.equal(row.hash, 'abc');
  assert.equal(row.xml, '<x/>');
  assert.equal(row.status, 'PENDING_SEND');
  assert.equal(row.attempts, 2);
  assert.equal(row.seq, 1);
  assert.equal(row.issuer_nif, '');
  assert.equal(row.expedition_date, '');
  assert.throws(() => database.exec("DELETE FROM verifactu_registration WHERE id = 'r1'"), /cannot be deleted/);
  database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, hash, xml, status, created_at)
    VALUES ('r2', 'inv1', '2026/000001', 'ANULACION', 'B12345674', '15-10-2026', 'def', '<y/>', 'PENDING_SEND', 'now')`).run();
  const next = /** @type {any} */ (database.prepare('SELECT seq FROM verifactu_registration WHERE id = ?').get('r2'));
  assert.equal(next.seq, 2);
  const versions = database.prepare('SELECT version FROM verifactu_schema_version ORDER BY version').all();
  assert.deepEqual(versions.map((/** @type {any} */ item) => item.version), [1, 2]);
});

test('delivery fields can change', () => {
  const {database} = fakeConnection();
  migrate(database);
  insertRegistration(database);
  database.exec("UPDATE verifactu_registration SET status = 'SENT', attempts = 1, aeat_csv = 'CSV1', sent_at = 'now', last_error = NULL WHERE id = 'r1'");
  const row = /** @type {any} */ (database.prepare("SELECT status, aeat_csv FROM verifactu_registration WHERE id = 'r1'").get());
  assert.equal(row.status, 'SENT');
  assert.equal(row.aeat_csv, 'CSV1');
});
