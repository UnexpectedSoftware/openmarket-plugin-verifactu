---
name: verifactu-plugin
description: Recipes for the OpenMarket VeriFactu plugin, phase by phase - schema migrations, hash chain, sync registration handler, durable AEAT sender, QR receipt block, settings, release zip - plus the done-checklist. Use for any code change in this repository.
metadata:
  short-description: VeriFactu plugin recipes
---

# VeriFactu plugin recipes

Rules are in `AGENTS.md`. Read only the `docs/PLAN.md` section for the phase you are on, and its GitHub issue for the acceptance criteria. The payload contract is OpenMarket's `InvoiceIssued.v1.json` / `InvoiceCancelled.v1.json` fixtures (amounts in integer cents, quantities in milli-units).

## Change the schema
1. Add a `V<n>` block in `src/store/migrations.js`, bump `SCHEMA_VERSION`, insert the version row in the same transaction.
2. Prefix every table and trigger with `verifactu_`. Never weaken the immutability triggers.
3. Test: migrating twice is a no-op; existing rows survive.

## Hash chain (phase 2)
1. Pure functions in `src/hash` (`node:crypto` SHA-256), input fields exactly as the AEAT spec orders them.
2. Test against the official AEAT vectors stored in `test/vectors`.

## Sync handler (phase 3)
1. Handler in `src/subscribers/`, registered with `eventBus.subscribeSync(events.<Event>, …)`.
2. Read the last row (`ORDER BY seq DESC LIMIT 1`) on `connection.database`, hash with `src/hash`, build XML with `src/xml`, insert `PENDING_SEND`.
3. No network, no clock but the payload. Throw on bad input.
4. Test with `test/fakes`: run the handler inside `BEGIN … ROLLBACK` and assert nothing persists.

## Durable sender (phase 4)
1. Name starts with `verifactu:`; idempotent by `invoice_id`; send in `seq` order. mTLS via `https.request({pfx, passphrase})`; the passphrase comes from `await secrets.get(key)`, never from `config`.
2. Update only delivery fields (`status`, `attempts`, `last_error`, `aeat_csv`, `sent_at`).
3. Test with a fake SOAP client: a retry sends once; "already registered" → `SENT`.

## Receipt block (phase 5)
`receipt.register('receipt.footer', render)`; `render(payload)` is synchronous and local and returns blocks (`text`, `qr` with `sizeMm` 30–40 and `correction` `M`, `line`, `feed`). `payload` is `null` when the order has no invoice.

## Finish
```bash
npm test && npm run typecheck && npm run build
```
PR body names the phase and the issue it closes. Release: bump `plugin.json` + `package.json`, tag `v<version>`.
