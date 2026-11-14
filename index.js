'use strict';

const {migrate} = require('./src/store/migrations');
const {registerSubscribers} = require('./src/subscribers');

const SUPPORTED_API_VERSION = 1;
const REQUIRED_EVENTS = ['InvoiceIssued', 'InvoiceCancelled'];

/**
 * @typedef {object} PluginEventBus
 * @property {(EventType: Function, handler: (event: any) => void) => (() => void)} subscribeSync
 * @property {(name: string, EventType: Function, handler: (event: any) => void, options?: {ordered?: boolean, maxAttempts?: number}) => (() => void)} subscribeDurable
 * @property {(EventType: Function) => any} [ofType]
 */

/**
 * @typedef {object} PluginContext
 * @property {number} apiVersion
 * @property {PluginEventBus} eventBus
 * @property {{database: import('node:sqlite').DatabaseSync}} connection
 * @property {Record<string, string>} [config] saved settings; secret settings are not included
 * @property {{get: (key: string) => Promise<string | null>}} secrets secret settings (e.g. certificatePassword); call only from durable handlers
 * @property {{register: (slot: 'receipt.header.fiscal' | 'receipt.footer', render: (invoicePayload: object | null) => object[]) => (() => void)}} receipt ticket blocks; render is synchronous and local
 * @property {Record<string, Function>} events
 */

/**
 * Entry point called by OpenMarket's plugin loader.
 * Phase 1: checks the API version, runs migrations and registers stub subscribers.
 * @param {PluginContext} context
 */
function register(context) {
  if (!context || context.apiVersion !== SUPPORTED_API_VERSION) {
    const got = context ? context.apiVersion : undefined;
    throw new Error(`verifactu: unsupported OpenMarket plugin apiVersion ${String(got)}; this plugin needs apiVersion ${SUPPORTED_API_VERSION}`);
  }
  const {eventBus, connection, events} = context;
  if (!eventBus || typeof eventBus.subscribeSync !== 'function' || typeof eventBus.subscribeDurable !== 'function') {
    throw new Error('verifactu: the plugin context has no eventBus with subscribeSync/subscribeDurable');
  }
  if (!connection || !connection.database) {
    throw new Error('verifactu: the plugin context has no connection.database');
  }
  const missing = REQUIRED_EVENTS.filter(name => !events || typeof events[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`verifactu: this OpenMarket version does not expose ${missing.join(', ')}; update OpenMarket to a version with invoices`);
  }
  migrate(connection.database);
  registerSubscribers({eventBus, events, database: connection.database, config: context.config || {}});
}

module.exports = {register, SUPPORTED_API_VERSION};
