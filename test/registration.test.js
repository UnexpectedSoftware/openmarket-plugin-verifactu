'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {register} = require('../index');
const {fakeContext, InvoiceIssued, InvoiceCancelled} = require('./fakes');
const {hashRegistroAlta, hashRegistroAnulacion} = require('../src/hash');
const plugin = require('../plugin.json');

const ISSUED = {
  schemaVersion: 1,
  invoiceId: '6f1c0b9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
  type: 'F2',
  series: '2026',
  number: 42,
  invoiceNumber: '2026/000042',
  issueDate: '2026-10-15',
  issuedAt: '2026-10-15T22:41:07+02:00',
  orderId: 'a9e00b9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
  currency: 'EUR',
  issuer: {
    nif: 'B12345674',
    legalName: 'Ultramarinos Pérez SL',
    tradeName: 'Ultramarinos Pérez',
    address: {
      street: 'Calle Mayor 1',
      postalCode: '28013',
      city: 'Madrid',
      province: 'Madrid',
      country: 'ES'
    }
  },
  lines: [
    {position: 0, name: 'Leche', amountCents: 190, vat: {kind: 'S1', percent: 4, cause: null}},
    {position: 1, name: 'Jamón (kg)', amountCents: 648, vat: {kind: 'S1', percent: 10, cause: null}}
  ],
  vatBreakdown: [
    {kind: 'S1', percent: 4, cause: null, baseCents: 183, quotaCents: 7, grossCents: 190},
    {kind: 'S1', percent: 10, cause: null, baseCents: 589, quotaCents: 59, grossCents: 648}
  ],
  totalCents: 838,
  vatTotalCents: 66,
  corrects: null
};

/** @returns {typeof ISSUED} */
function issuedFixture() {
  return JSON.parse(JSON.stringify(ISSUED));
}

/** @returns {Record<string, unknown>} */
function cancelledFixture() {
  const issued = issuedFixture();
  return {
    schemaVersion: 1,
    invoiceId: issued.invoiceId,
    type: issued.type,
    series: issued.series,
    number: issued.number,
    invoiceNumber: issued.invoiceNumber,
    issueDate: issued.issueDate,
    issuedAt: issued.issuedAt,
    issuer: issued.issuer,
    totalCents: issued.totalCents,
    cancelledAt: '2026-10-16T11:05:00+02:00',
    reason: null
  };
}

/**
 * @param {Record<string, string>} [config]
 */
function open(config = {}) {
  const context = fakeContext({config});
  register(context);
  const bus = /** @type {any} */ (context.eventBus);
  return {
    database: context.connection.database,
    issued: bus.sync.find((/** @type {any} */ subscriber) => subscriber.EventType.type === 'InvoiceIssued').handler,
    cancelled: bus.sync.find((/** @type {any} */ subscriber) => subscriber.EventType.type === 'InvoiceCancelled').handler,
  };
}

/** @param {import('node:sqlite').DatabaseSync} database */
function countOf(database) {
  return /** @type {{n: number}} */ (database.prepare('SELECT COUNT(*) AS n FROM verifactu_registration').get()).n;
}

/**
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function text(xml, tag) {
  const match = new RegExp(`<sf:${tag}>([^<]*)</sf:${tag}>`).exec(xml);
  assert.ok(match, tag);
  return /** @type {string} */ (match[1]);
}

test('issuing an invoice writes a chained alta and rolls back with the sale', () => {
  const {database, issued} = open();
  database.exec('BEGIN');
  issued(new InvoiceIssued(issuedFixture()));
  const row = /** @type {any} */ (database.prepare('SELECT * FROM verifactu_registration').get());
  assert.equal(row.id, `${ISSUED.invoiceId}:ALTA`);
  assert.equal(row.invoice_id, ISSUED.invoiceId);
  assert.equal(row.invoice_number, '2026/000042');
  assert.equal(row.kind, 'ALTA');
  assert.equal(row.issuer_nif, 'B12345674');
  assert.equal(row.expedition_date, '15-10-2026');
  assert.equal(row.previous_hash, null);
  assert.equal(row.status, 'PENDING_SEND');
  assert.equal(row.attempts, 0);
  assert.equal(row.created_at, ISSUED.issuedAt);
  assert.equal(row.hash, hashRegistroAlta({
    idEmisorFactura: text(row.xml, 'IDEmisorFactura'),
    numSerieFactura: text(row.xml, 'NumSerieFactura'),
    fechaExpedicionFactura: text(row.xml, 'FechaExpedicionFactura'),
    tipoFactura: text(row.xml, 'TipoFactura'),
    cuotaTotal: text(row.xml, 'CuotaTotal'),
    importeTotal: text(row.xml, 'ImporteTotal'),
    fechaHoraHusoGenRegistro: text(row.xml, 'FechaHoraHusoGenRegistro'),
  }));
  assert.equal(text(row.xml, 'CuotaTotal'), '0.66');
  assert.equal(text(row.xml, 'ImporteTotal'), '8.38');
  assert.equal(text(row.xml, 'TipoFactura'), 'F2');
  assert.equal(text(row.xml, 'DescripcionOperacion'), 'Leche, Jamón (kg)');
  assert.equal(text(row.xml, 'RefExterna'), ISSUED.invoiceId);
  assert.match(row.xml, /<sf:BaseImponibleOimporteNoSujeto>1\.83<\/sf:BaseImponibleOimporteNoSujeto>/);
  assert.match(row.xml, /<sf:CuotaRepercutida>0\.07<\/sf:CuotaRepercutida>/);
  assert.match(row.xml, /<sf:TipoImpositivo>4<\/sf:TipoImpositivo>/);
  assert.match(row.xml, /<sf:TipoImpositivo>10<\/sf:TipoImpositivo>/);
  assert.match(row.xml, /<sf:BaseImponibleOimporteNoSujeto>5\.89<\/sf:BaseImponibleOimporteNoSujeto>/);
  assert.match(row.xml, /<sf:PrimerRegistro>S<\/sf:PrimerRegistro>/);
  assert.match(row.xml, /<sf:NombreSistemaInformatico>OpenMarket<\/sf:NombreSistemaInformatico>/);
  assert.match(row.xml, /<sf:IdSistemaInformatico>OM<\/sf:IdSistemaInformatico>/);
  assert.match(row.xml, new RegExp(`<sf:Version>${plugin.version}</sf:Version>`));
  assert.match(row.xml, /<sf:NumeroInstalacion>1<\/sf:NumeroInstalacion>/);
  assert.match(row.xml, new RegExp(`<sf:Huella>${row.hash}</sf:Huella>`));
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('the next invoice and a later cancellation chain to the previous row', () => {
  const {database, issued, cancelled} = open();
  const second = issuedFixture();
  second.invoiceId = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';
  second.number = 43;
  second.invoiceNumber = '2026/000043';
  second.issuedAt = '2026-10-15T22:50:00+02:00';
  database.exec('BEGIN');
  issued(new InvoiceIssued(issuedFixture()));
  issued(new InvoiceIssued(second));
  cancelled(new InvoiceCancelled(cancelledFixture()));
  const rows = /** @type {any[]} */ (database.prepare('SELECT * FROM verifactu_registration ORDER BY seq').all());
  assert.equal(rows.length, 3);
  assert.equal(rows[1].previous_hash, rows[0].hash);
  assert.match(rows[1].xml, /<sf:RegistroAnterior>[\s\S]*<sf:IDEmisorFactura>B12345674<\/sf:IDEmisorFactura>[\s\S]*<sf:NumSerieFactura>2026\/000042<\/sf:NumSerieFactura>[\s\S]*<sf:FechaExpedicionFactura>15-10-2026<\/sf:FechaExpedicionFactura>/);
  assert.match(rows[1].xml, new RegExp(`<sf:Huella>${rows[0].hash}</sf:Huella>`));
  assert.equal(rows[2].kind, 'ANULACION');
  assert.equal(rows[2].invoice_id, ISSUED.invoiceId);
  assert.equal(rows[2].previous_hash, rows[1].hash);
  assert.match(rows[2].xml, /<sf:NumSerieFacturaAnulada>2026\/000042<\/sf:NumSerieFacturaAnulada>/);
  assert.match(rows[2].xml, /<sf:RegistroAnterior>[\s\S]*<sf:NumSerieFactura>2026\/000043<\/sf:NumSerieFactura>/);
  assert.match(rows[2].xml, new RegExp(`<sf:Huella>${rows[1].hash}</sf:Huella>`));
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('cancelling an invoice writes an anulacion chained to its alta', () => {
  const {database, issued, cancelled} = open();
  database.exec('BEGIN');
  issued(new InvoiceIssued(issuedFixture()));
  cancelled(new InvoiceCancelled(cancelledFixture()));
  const rows = /** @type {any[]} */ (database.prepare('SELECT * FROM verifactu_registration ORDER BY seq').all());
  const alta = rows[0];
  const row = rows[1];
  assert.equal(row.id, `${ISSUED.invoiceId}:ANULACION`);
  assert.equal(row.kind, 'ANULACION');
  assert.equal(row.previous_hash, alta.hash);
  assert.equal(row.created_at, '2026-10-16T11:05:00+02:00');
  assert.equal(row.expedition_date, '15-10-2026');
  assert.equal(row.hash, hashRegistroAnulacion({
    idEmisorFacturaAnulada: 'B12345674',
    numSerieFacturaAnulada: '2026/000042',
    fechaExpedicionFacturaAnulada: '15-10-2026',
    huella: alta.hash,
    fechaHoraHusoGenRegistro: '2026-10-16T11:05:00+02:00',
  }));
  assert.match(row.xml, new RegExp(`<sf:Huella>${row.hash}</sf:Huella>`));
  assert.throws(() => cancelled(new InvoiceCancelled(cancelledFixture())), /already has an ANULACION/);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('a configured NIF must match the invoice issuer', () => {
  const match = open({nif: ' B12345674 '});
  match.database.exec('BEGIN');
  match.issued(new InvoiceIssued(issuedFixture()));
  assert.equal(countOf(match.database), 1);
  match.database.exec('ROLLBACK');

  const mismatch = open({nif: '99999999R'});
  mismatch.database.exec('BEGIN');
  assert.throws(() => mismatch.issued(new InvoiceIssued(issuedFixture())), /does not match/);
  mismatch.database.exec('ROLLBACK');
  assert.equal(countOf(mismatch.database), 0);
});

test('softwareId is written when it is 1 or 2 characters', () => {
  const {database, issued} = open({softwareId: 'VF'});
  database.exec('BEGIN');
  issued(new InvoiceIssued(issuedFixture()));
  const row = /** @type {any} */ (database.prepare('SELECT xml FROM verifactu_registration').get());
  assert.match(row.xml, /<sf:IdSistemaInformatico>VF<\/sf:IdSistemaInformatico>/);
  database.exec('ROLLBACK');

  const bad = open({softwareId: 'OPEN'});
  bad.database.exec('BEGIN');
  assert.throws(() => bad.issued(new InvoiceIssued(issuedFixture())), /softwareId must be 1 or 2 characters/);
  bad.database.exec('ROLLBACK');
  assert.equal(countOf(bad.database), 0);
});

test('the operation description is cut at 500 characters', () => {
  const {database, issued} = open();
  const event = issuedFixture();
  event.lines = [{position: 0, name: 'A'.repeat(600), amountCents: 190, vat: {kind: 'S1', percent: 4, cause: null}}];
  database.exec('BEGIN');
  issued(new InvoiceIssued(event));
  const row = /** @type {any} */ (database.prepare('SELECT xml FROM verifactu_registration').get());
  const description = /<sf:DescripcionOperacion>([^<]*)<\/sf:DescripcionOperacion>/.exec(row.xml);
  assert.ok(description);
  assert.equal(/** @type {string} */ (description[1]).length, 500);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('an exempt invoice is registered without a repercutida quota', () => {
  const {database, issued} = open();
  const event = /** @type {any} */ (issuedFixture());
  event.lines = [{position: 0, name: 'Pan', amountCents: 100, vat: {kind: 'E', percent: 0, cause: 'E1'}}];
  event.vatBreakdown = [{kind: 'E', percent: 0, cause: 'E1', baseCents: 100, quotaCents: 0, grossCents: 100}];
  event.vatTotalCents = 0;
  event.totalCents = 100;
  database.exec('BEGIN');
  issued(new InvoiceIssued(event));
  const row = /** @type {any} */ (database.prepare('SELECT xml FROM verifactu_registration').get());
  assert.match(row.xml, /<sf:OperacionExenta>E1<\/sf:OperacionExenta>/);
  assert.doesNotMatch(row.xml, /CuotaRepercutida/);
  assert.match(row.xml, /<sf:CuotaTotal>0\.00<\/sf:CuotaTotal>/);
  assert.match(row.xml, /<sf:ImporteTotal>1\.00<\/sf:ImporteTotal>/);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('bad invoice input throws and leaves no row', () => {
  /** @type {{message: RegExp, change: (event: any) => void}[]} */
  const cases = [
    {message: /schemaVersion 0/, change: event => { event.schemaVersion = 0; }},
    {message: /unsupported invoice type R5/, change: event => { event.type = 'R5'; }},
    {message: /issuer is required/, change: event => { event.issuer = null; }},
    {message: /issuer NIF must be 9 characters/, change: event => { event.issuer.nif = 'B123'; }},
    {message: /country must be ES/, change: event => { event.issuer.address.country = 'PT'; }},
    {message: /issuedAt must be/, change: event => { event.issuedAt = '2026-10-15T22:41:07.123+02:00'; }},
    {message: /issueDate must be YYYY-MM-DD/, change: event => { event.issueDate = '15-10-2026'; }},
    {message: /invoice lines are required/, change: event => { event.lines = []; }},
    {message: /vatBreakdown is required/, change: event => { event.vatBreakdown = []; }},
    {message: /does not add up/, change: event => { event.totalCents = 1; }},
    {message: /exempt VAT row cannot have a quota/, change: event => {
      event.vatBreakdown = [{kind: 'E', percent: 0, cause: 'E1', baseCents: 100, quotaCents: 5, grossCents: 100}];
      event.vatTotalCents = 5;
      event.totalCents = 100;
    }},
  ];
  for (const item of cases) {
    const {database, issued} = open();
    const event = issuedFixture();
    item.change(event);
    database.exec('BEGIN');
    assert.throws(() => issued(new InvoiceIssued(event)), item.message);
    database.exec('ROLLBACK');
    assert.equal(countOf(database), 0, String(item.message));
  }
});

test('a second alta and a cancellation without an alta roll back', () => {
  const {database, issued, cancelled} = open();
  database.exec('BEGIN');
  issued(new InvoiceIssued(issuedFixture()));
  assert.throws(() => issued(new InvoiceIssued(issuedFixture())), /already has an ALTA/);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);

  database.exec('BEGIN');
  assert.throws(() => cancelled(new InvoiceCancelled(cancelledFixture())), /has no ALTA/);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 0);
});

test('a registration with no issuer NIF stops the chain', () => {
  const {database, issued} = open();
  database.prepare(`INSERT INTO verifactu_registration
    (id, invoice_id, invoice_number, kind, issuer_nif, expedition_date, hash, xml, status, created_at)
    VALUES ('legacy', 'old', '2020/000001', 'ALTA', '', '', 'abc', '<x/>', 'PENDING_SEND', '2020-01-01T00:00:00+01:00')`).run();
  database.exec('BEGIN');
  assert.throws(() => issued(new InvoiceIssued(issuedFixture())), /no issuer NIF/);
  database.exec('ROLLBACK');
  assert.equal(countOf(database), 1);
  assert.equal(database.prepare('SELECT id FROM verifactu_registration WHERE invoice_id = ?').get(ISSUED.invoiceId), undefined);
});
