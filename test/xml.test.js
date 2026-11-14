'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {hashRegistroAlta, hashRegistroAnulacion} = require('../src/hash');
const {buildRegistroAlta, buildRegistroAnulacion, formatAmount, formatExpeditionDate, requireTimestamp} = require('../src/xml');

/** @type {{cases: {id: string, kind: string, fields: Record<string, string>, hash: string}[]}} */
const vectors = JSON.parse(readFileSync(path.join(__dirname, 'vectors', 'aeat-huella.json'), 'utf8'));
const alta = vectors.cases.find(item => item.id === '6.1');
const chained = vectors.cases.find(item => item.id === '6.2');
const anulacion = vectors.cases.find(item => item.id === '6.3');

/** @returns {import('../src/xml').SistemaInformatico} */
function software() {
  return {
    nombreRazon: 'AEAT Example',
    nif: '89890001K',
    nombreSistemaInformatico: 'OpenMarket',
    idSistemaInformatico: 'OM',
    version: '0.1.0',
    numeroInstalacion: '1',
    tipoUsoPosibleSoloVerifactu: 'S',
    tipoUsoPosibleMultiOT: 'N',
    indicadorMultiplesOT: 'N',
  };
}

/**
 * @param {Record<string, string>} fields
 * @param {string} hash
 * @param {import('../src/xml').RegistroAnterior|null} previous
 */
function altaXml(fields, hash, previous) {
  return buildRegistroAlta({
    idEmisorFactura: fields.idEmisorFactura,
    numSerieFactura: fields.numSerieFactura,
    fechaExpedicionFactura: fields.fechaExpedicionFactura,
    tipoFactura: fields.tipoFactura,
    cuotaTotal: fields.cuotaTotal,
    importeTotal: fields.importeTotal,
    fechaHoraHusoGenRegistro: fields.fechaHoraHusoGenRegistro,
    hash,
    nombreRazonEmisor: 'AEAT Example',
    descripcionOperacion: 'Tom & Jerry',
    refExterna: 'ref-1',
    breakdown: [{kind: 'S1', percent: 10, cause: null, baseCents: 11110, quotaCents: 1235}],
    previous,
    software: software(),
  });
}

test('formats cents as two decimal places without floating point', () => {
  assert.equal(formatAmount(838), '8.38');
  assert.equal(formatAmount(1235), '12.35');
  assert.equal(formatAmount(0), '0.00');
  assert.equal(formatAmount(7), '0.07');
  assert.equal(formatAmount(-150), '-1.50');
  assert.throws(() => formatAmount(1.5), /integer cents/);
  assert.equal(formatExpeditionDate('2026-10-15'), '15-10-2026');
  assert.throws(() => formatExpeditionDate('15-10-2026'), /YYYY-MM-DD/);
  assert.equal(requireTimestamp('2026-10-15T22:41:07+02:00', 'issuedAt'), '2026-10-15T22:41:07+02:00');
  assert.throws(() => requireTimestamp('2026-10-15T22:41:07Z', 'issuedAt'), /issuedAt/);
  assert.throws(() => requireTimestamp('2026-10-15T22:41:07.123+02:00', 'issuedAt'), /issuedAt/);
});

test('official alta vectors keep the hashed characters in the XML', () => {
  assert.ok(alta);
  assert.ok(chained);
  const first = altaXml(alta.fields, alta.hash, null);
  assert.equal(hashRegistroAlta(/** @type {import('../src/hash').AltaHashFields} */ (alta.fields)), alta.hash);
  assert.match(first, new RegExp(`xmlns:sf="https://www2\\.agenciatributaria\\.gob\\.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion\\.xsd"`));
  assert.match(first, /<sf:IDEmisorFactura>89890001K<\/sf:IDEmisorFactura>/);
  assert.match(first, /<sf:NumSerieFactura>12345678\/G33<\/sf:NumSerieFactura>/);
  assert.match(first, /<sf:FechaExpedicionFactura>01-01-2024<\/sf:FechaExpedicionFactura>/);
  assert.match(first, /<sf:TipoFactura>F1<\/sf:TipoFactura>/);
  assert.match(first, /<sf:CuotaTotal>12\.35<\/sf:CuotaTotal>/);
  assert.match(first, /<sf:ImporteTotal>123\.45<\/sf:ImporteTotal>/);
  assert.match(first, /<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30\+01:00<\/sf:FechaHoraHusoGenRegistro>/);
  assert.match(first, /<sf:PrimerRegistro>S<\/sf:PrimerRegistro>/);
  assert.doesNotMatch(first, /RegistroAnterior/);
  assert.match(first, /<sf:DescripcionOperacion>Tom &amp; Jerry<\/sf:DescripcionOperacion>/);
  assert.match(first, new RegExp(`<sf:TipoHuella>01</sf:TipoHuella>\\s*<sf:Huella>${alta.hash}</sf:Huella>`));
  assert.equal(first.split('<sf:Huella>').length - 1, 1);

  const second = altaXml(chained.fields, chained.hash, {
    idEmisorFactura: '89890001K',
    numSerieFactura: '12345678/G33',
    fechaExpedicionFactura: '01-01-2024',
    huella: /** @type {string} */ (chained.fields.huella),
  });
  assert.match(second, /<sf:NumSerieFactura>12345679\/G34<\/sf:NumSerieFactura>/);
  assert.match(second, /<sf:CuotaTotal>12\.35<\/sf:CuotaTotal>/);
  assert.match(second, /<sf:ImporteTotal>123\.45<\/sf:ImporteTotal>/);
  assert.match(second, new RegExp(`<sf:RegistroAnterior>[\\s\\S]*<sf:Huella>${chained.fields.huella}</sf:Huella>`));
  assert.match(second, new RegExp(`<sf:TipoHuella>01</sf:TipoHuella>\\s*<sf:Huella>${chained.hash}</sf:Huella>`));
  assert.throws(() => altaXml(alta.fields, 'A'.repeat(64), null), /does not match/);
});

test('the official anulacion vector keeps the hashed characters in the XML', () => {
  assert.ok(anulacion);
  const xml = buildRegistroAnulacion({
    idEmisorFacturaAnulada: anulacion.fields.idEmisorFacturaAnulada,
    numSerieFacturaAnulada: anulacion.fields.numSerieFacturaAnulada,
    fechaExpedicionFacturaAnulada: anulacion.fields.fechaExpedicionFacturaAnulada,
    fechaHoraHusoGenRegistro: anulacion.fields.fechaHoraHusoGenRegistro,
    hash: anulacion.hash,
    refExterna: 'ref-3',
    previous: {
      idEmisorFactura: '89890001K',
      numSerieFactura: '12345679/G34',
      fechaExpedicionFactura: '01-01-2024',
      huella: /** @type {string} */ (anulacion.fields.huella),
    },
    software: software(),
  });
  assert.equal(hashRegistroAnulacion(/** @type {import('../src/hash').AnulacionHashFields} */ (anulacion.fields)), anulacion.hash);
  assert.match(xml, /<sf:IDEmisorFacturaAnulada>89890001K<\/sf:IDEmisorFacturaAnulada>/);
  assert.match(xml, /<sf:NumSerieFacturaAnulada>12345679\/G34<\/sf:NumSerieFacturaAnulada>/);
  assert.match(xml, /<sf:FechaExpedicionFacturaAnulada>01-01-2024<\/sf:FechaExpedicionFacturaAnulada>/);
  assert.match(xml, /<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:40\+01:00<\/sf:FechaHoraHusoGenRegistro>/);
  assert.match(xml, new RegExp(`<sf:RegistroAnterior>[\\s\\S]*<sf:Huella>${anulacion.fields.huella}</sf:Huella>`));
  assert.match(xml, new RegExp(`<sf:TipoHuella>01</sf:TipoHuella>\\s*<sf:Huella>${anulacion.hash}</sf:Huella>`));
});

test('exempt and not-subject rows omit the rate and the quota', () => {
  assert.ok(alta);
  const exempt = buildRegistroAlta({
    idEmisorFactura: alta.fields.idEmisorFactura,
    numSerieFactura: alta.fields.numSerieFactura,
    fechaExpedicionFactura: alta.fields.fechaExpedicionFactura,
    tipoFactura: alta.fields.tipoFactura,
    cuotaTotal: alta.fields.cuotaTotal,
    importeTotal: alta.fields.importeTotal,
    fechaHoraHusoGenRegistro: alta.fields.fechaHoraHusoGenRegistro,
    hash: alta.hash,
    nombreRazonEmisor: 'AEAT Example',
    descripcionOperacion: 'Pan',
    refExterna: 'ref-e',
    breakdown: [
      {kind: 'E', percent: 0, cause: 'E1', baseCents: 100, quotaCents: 0},
      {kind: 'N', percent: 0, cause: 'N2', baseCents: 50, quotaCents: 0},
    ],
    previous: null,
    software: software(),
  });
  assert.match(exempt, /<sf:OperacionExenta>E1<\/sf:OperacionExenta>/);
  assert.match(exempt, /<sf:CalificacionOperacion>N2<\/sf:CalificacionOperacion>/);
  assert.doesNotMatch(exempt, /TipoImpositivo/);
  assert.doesNotMatch(exempt, /CuotaRepercutida/);
  assert.throws(() => buildRegistroAlta({
    idEmisorFactura: alta.fields.idEmisorFactura,
    numSerieFactura: alta.fields.numSerieFactura,
    fechaExpedicionFactura: alta.fields.fechaExpedicionFactura,
    tipoFactura: alta.fields.tipoFactura,
    cuotaTotal: alta.fields.cuotaTotal,
    importeTotal: alta.fields.importeTotal,
    fechaHoraHusoGenRegistro: alta.fields.fechaHoraHusoGenRegistro,
    hash: alta.hash,
    nombreRazonEmisor: 'AEAT Example',
    descripcionOperacion: 'Pan',
    refExterna: 'ref-e',
    breakdown: [{kind: 'E', percent: 0, cause: 'E1', baseCents: 100, quotaCents: 5}],
    previous: null,
    software: software(),
  }), /cannot have a quota/);
});
