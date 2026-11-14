'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {
  TIPO_HUELLA,
  registroAltaInput,
  hashRegistroAlta,
  registroAnulacionInput,
  hashRegistroAnulacion,
} = require('../src/hash');

/**
 * @typedef {object} VectorCase
 * @property {string} id
 * @property {'ALTA'|'ANULACION'} kind
 * @property {Record<string, string>} fields
 * @property {string} input
 * @property {number} bytes
 * @property {string} hash
 */

/** @type {{source: string, cases: VectorCase[]}} */
const vectors = JSON.parse(readFileSync(path.join(__dirname, 'vectors', 'aeat-huella.json'), 'utf8'));

const alta = /** @type {VectorCase} */ (vectors.cases.find(item => item.id === '6.1'));
const chained = /** @type {VectorCase} */ (vectors.cases.find(item => item.id === '6.2'));
const anulacion = /** @type {VectorCase} */ (vectors.cases.find(item => item.id === '6.3'));
const altaFields = /** @type {import('../src/hash').AltaHashFields} */ (alta.fields);
const chainedFields = /** @type {import('../src/hash').AltaHashFields} */ (chained.fields);
const anulacionFields = /** @type {import('../src/hash').AnulacionHashFields} */ (anulacion.fields);

test('official AEAT huella vectors (v0.1.2 §6.1–§6.3)', () => {
  assert.match(vectors.source, /v0\.1\.2/);
  assert.equal(TIPO_HUELLA, '01');
  for (const vector of vectors.cases) {
    const input = vector.kind === 'ALTA'
      ? registroAltaInput(/** @type {import('../src/hash').AltaHashFields} */ (vector.fields))
      : registroAnulacionInput(/** @type {import('../src/hash').AnulacionHashFields} */ (vector.fields));
    const hash = vector.kind === 'ALTA'
      ? hashRegistroAlta(/** @type {import('../src/hash').AltaHashFields} */ (vector.fields))
      : hashRegistroAnulacion(/** @type {import('../src/hash').AnulacionHashFields} */ (vector.fields));
    assert.equal(input, vector.input, vector.id);
    assert.equal(Buffer.byteLength(input, 'utf8'), vector.bytes, vector.id);
    assert.equal(hash, vector.hash, vector.id);
    assert.match(hash, /^[0-9A-F]{64}$/);
  }
  assert.equal(chained.fields.huella, alta.hash);
  assert.equal(anulacion.fields.huella, chained.hash);
});

test('an omitted, null, or empty previous hash is the first record', () => {
  const first = {...chainedFields};
  delete first.huella;
  const omitted = registroAltaInput(first);
  assert.match(omitted, /&Huella=&/);
  assert.equal(registroAltaInput({...first, huella: null}), omitted);
  assert.equal(registroAltaInput({...first, huella: ''}), omitted);
  assert.equal(registroAltaInput({...first, huella: '  '}), omitted);
});

test('trims ASCII edges and keeps interior spaces', () => {
  const padded = {...altaFields, numSerieFactura: ' \t12345678/G33\n'};
  assert.equal(hashRegistroAlta(padded), alta.hash);

  const interior = {...altaFields, numSerieFactura: '  12345678 / G33  '};
  const input = registroAltaInput(interior);
  assert.match(input, /NumSerieFactura=12345678 \/ G33&/);
  assert.notEqual(hashRegistroAlta(interior), alta.hash);

  const nbsp = {...altaFields, numSerieFactura: '\u00A012345678/G33'};
  assert.notEqual(hashRegistroAlta(nbsp), alta.hash);
});

test('throws when a required field is missing or blank', () => {
  /** @type {Partial<import('../src/hash').AltaHashFields>} */
  const withoutNif = {...altaFields};
  delete withoutNif.idEmisorFactura;
  assert.throws(
    () => hashRegistroAlta(/** @type {import('../src/hash').AltaHashFields} */ (withoutNif)),
    /IDEmisorFactura is required/,
  );
  assert.throws(
    () => hashRegistroAnulacion({...anulacionFields, idEmisorFacturaAnulada: '   '}),
    /IDEmisorFacturaAnulada is required/,
  );
  assert.throws(() => hashRegistroAlta(/** @type {any} */ (null)), /hash fields are required/);
});
