'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {migrate, SCHEMA_VERSION} = require('../src/store/migrations');
const {fakeConnection} = require('./fakes');

/** @param {import('node:sqlite').DatabaseSync} db */
function insertRegistration(db) {
  db.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, previous_hash, hash, xml, status, created_at)
    VALUES ('r1', 'inv1', '2026/000001', 'ALTA', NULL, 'abc', '<x/>', 'PENDING_SEND', '2026-10-15T10:00:00+02:00')`).run();
}

test('migrations are idempotent', () => {
  const {database} = fakeConnection();
  assert.equal(migrate(database), SCHEMA_VERSION);
  assert.equal(migrate(database), SCHEMA_VERSION);
  const rows = database.prepare('SELECT version FROM verifactu_schema_version').all();
  assert.equal(rows.length, 1);
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

test('invoice_id is unique', () => {
  const {database} = fakeConnection();
  migrate(database);
  insertRegistration(database);
  assert.throws(() => database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, hash, xml, status, created_at)
    VALUES ('r2', 'inv1', '2026/000001', 'ALTA', 'def', '<x/>', 'PENDING_SEND', 'now')`).run(), /UNIQUE/);
});

test('triggers reject delete and rewriting the hash', () => {
  const {database} = fakeConnection();
  migrate(database);
  insertRegistration(database);
  assert.throws(() => database.exec("DELETE FROM verifactu_registration WHERE id = 'r1'"), /cannot be deleted/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET hash = 'zzz' WHERE id = 'r1'"), /immutable/);
  assert.throws(() => database.exec("UPDATE verifactu_registration SET xml = '<y/>' WHERE id = 'r1'"), /immutable/);
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
