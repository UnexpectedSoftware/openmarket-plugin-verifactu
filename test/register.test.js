'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {register} = require('../index');
const {fakeContext, fakeEvents} = require('./fakes');

test('registers on apiVersion 1', () => {
  const context = fakeContext();
  register(context);
  const bus = /** @type {any} */ (context.eventBus);
  assert.equal(bus.sync.length, 2);
  assert.deepEqual(bus.sync.map((/** @type {any} */ s) => s.EventType.type), ['InvoiceIssued', 'InvoiceCancelled']);
});

test('throws a clear error on another apiVersion', () => {
  assert.throws(() => register(fakeContext({apiVersion: 2})), /unsupported OpenMarket plugin apiVersion 2/);
});

test('throws a clear error when core has no invoice events', () => {
  const events = fakeEvents();
  delete events.InvoiceIssued;
  assert.throws(() => register(fakeContext(/** @type {any} */ ({events}))), /does not expose InvoiceIssued/);
});

test('the durable sender is named verifactu:send', () => {
  const context = fakeContext();
  register(context);
  const bus = /** @type {any} */ (context.eventBus);
  const send = bus.durable.find((/** @type {any} */ d) => d.EventType.type === 'InvoiceIssued');
  assert.equal(send.name, 'verifactu:send');
  assert.ok(bus.durable.every((/** @type {any} */ d) => d.name.startsWith('verifactu:')));
});
