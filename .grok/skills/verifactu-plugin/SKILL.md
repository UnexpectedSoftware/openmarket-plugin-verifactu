---
name: verifactu-plugin
description: Recipes for implementing the OpenMarket VeriFactu plugin phase by phase — hash chain, registration rows, AEAT delivery, QR, settings — without importing OpenMarket source. Use for any change in this repository.
when-to-use: verifactu, AEAT, hash chain, RegistroAlta, RegistroAnulacion, SOAP, QR, certificate, plugin migration, subscriber, release zip
argument-hint: "[phase-2|phase-3|phase-4|phase-5|phase-6|phase-7|migration|release] <short description>"
metadata:
  short-description: VeriFactu plugin recipes
---

# VeriFactu plugin recipes

`AGENTS.md` has the rules. `docs/PLAN.md` has the phases. Work on **one phase** at a time; its GitHub issue holds the acceptance criteria.

## Recipe: change the schema
1. Add a `V<n>` block in `src/store/migrations.js`, bump `SCHEMA_VERSION`, insert the version row in the same transaction.
2. Prefix every table/trigger with `verifactu_`.
3. Test: migrating twice is a no-op; existing rows survive.

## Recipe: sync handler (phase 3)
1. Handler in `src/subscribers/`, registered with `eventBus.subscribeSync(events.<Event>, …)`.
2. Read the last row (`ORDER BY seq DESC LIMIT 1`) on `connection.database`, compute the hash with `src/hash`, build XML with `src/xml`, insert `PENDING_SEND`.
3. No network, no clock other than the event payload. Throw on bad input (rolls the sale back).
4. Test with `test/fakes`: call the handler inside `BEGIN … ROLLBACK` and assert nothing persists.

## Recipe: durable handler (phase 4)
1. Name starts with `verifactu:`; idempotent by `invoice_id`; send in `seq` order.
2. Update only delivery fields (`status`, `attempts`, `last_error`, `aeat_csv`, `sent_at`).
3. Test with a fake SOAP client: retry sends once; "already registered" → `SENT`.

## Finish
~~~bash
npm test && npm run typecheck && npm run build
~~~
PR body: the phase and issue it closes. Releases: bump `plugin.json` + `package.json`, tag `v<version>`.
