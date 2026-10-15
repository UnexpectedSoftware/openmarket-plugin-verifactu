'use strict';

/** Durable subscriber name. The loader requires the plugin id prefix. */
const SEND_SUBSCRIBER = 'verifactu:send';

/**
 * Registers the plugin's subscribers.
 * Phase 1: stubs only. Phase 3 fills the sync handlers (hash chain + registration row,
 * inside the sale transaction, no network). Phase 4 fills the durable sender.
 * @param {{eventBus: import('../../index').PluginEventBus, events: Record<string, Function>, database: import('node:sqlite').DatabaseSync, config: Record<string, string>}} deps
 */
function registerSubscribers({eventBus, events}) {
  eventBus.subscribeSync(events.InvoiceIssued, () => {
    // TODO(phase 3): read last registration, compute chained hash, insert ALTA row (PENDING_SEND).
  });
  eventBus.subscribeSync(events.InvoiceCancelled, () => {
    // TODO(phase 3): insert ANULACION row chained to the previous registration.
  });
  eventBus.subscribeDurable(SEND_SUBSCRIBER, events.InvoiceIssued, () => {
    // TODO(phase 4): send PENDING_SEND registrations to AEAT (mTLS), idempotent by invoice_id.
  });
  eventBus.subscribeDurable(`${SEND_SUBSCRIBER}-cancellation`, events.InvoiceCancelled, () => {
    // TODO(phase 4): send ANULACION registrations.
  });
}

module.exports = {registerSubscribers, SEND_SUBSCRIBER};
