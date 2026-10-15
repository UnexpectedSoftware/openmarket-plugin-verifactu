'use strict';

const {DatabaseSync} = require('node:sqlite');

/** Fake event classes shaped like OpenMarket's domain/event/registry.js entries. */
class InvoiceIssued {
  static get type() { return 'InvoiceIssued'; }
  static get durable() { return true; }
  /** @param {Record<string, any>} fields */
  constructor(fields) { Object.assign(this, fields); }
}
class InvoiceCancelled {
  static get type() { return 'InvoiceCancelled'; }
  static get durable() { return true; }
  /** @param {Record<string, any>} fields */
  constructor(fields) { Object.assign(this, fields); }
}
class OrderCreated {
  static get type() { return 'OrderCreated'; }
  /** @param {Record<string, any>} fields */
  constructor(fields) { Object.assign(this, fields); }
}

/** @returns {Record<string, Function>} */
function fakeEvents() {
  return {InvoiceIssued, InvoiceCancelled, OrderCreated};
}

/**
 * Records subscriptions like OpenMarket's scoped plugin bus. Durable names must use
 * the plugin prefix or have no colon (then they are prefixed), as the loader enforces.
 * @param {string} [pluginId]
 */
function fakeEventBus(pluginId = 'verifactu') {
  /** @type {{EventType: Function, handler: Function}[]} */
  const sync = [];
  /** @type {{name: string, EventType: Function, handler: Function, options: any}[]} */
  const durable = [];
  const prefix = `${pluginId}:`;
  return {
    sync,
    durable,
    /** @param {Function} EventType @param {Function} handler */
    subscribeSync(EventType, handler) {
      sync.push({EventType, handler});
      return () => {};
    },
    /** @param {string} name @param {Function} EventType @param {Function} handler @param {any} [options] */
    subscribeDurable(name, EventType, handler, options) {
      let scoped = name;
      if (!name.startsWith(prefix)) {
        if (name.includes(':')) throw new Error(`durable name ${name} must use ${prefix}`);
        scoped = prefix + name;
      }
      durable.push({name: scoped, EventType, handler, options});
      return () => {};
    },
    /** @param {Function} EventType */
    ofType(EventType) { return {EventType}; }
  };
}

/**
 * In-memory connection with the same shape OpenMarket passes: `{database: DatabaseSync}`.
 * @returns {{database: DatabaseSync}}
 */
function fakeConnection() {
  return {database: new DatabaseSync(':memory:')};
}

/** @param {Partial<{apiVersion: number}>} [overrides] */
function fakeContext(overrides = {}) {
  return {
    apiVersion: 1,
    eventBus: fakeEventBus(),
    connection: fakeConnection(),
    config: {},
    events: fakeEvents(),
    ...overrides
  };
}

module.exports = {fakeEvents, fakeEventBus, fakeConnection, fakeContext, InvoiceIssued, InvoiceCancelled};
