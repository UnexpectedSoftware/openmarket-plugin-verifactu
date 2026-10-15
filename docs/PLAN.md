# 4. VeriFactu Plugin (external repo)

## Goal
Implement VeriFactu compliance as a standalone plugin in its own repository (`UnexpectedSoftware/openmarket-plugin-verifactu`), installed by dropping its folder into `<userData>/plugins/verifactu/`. OpenMarket core contains zero VeriFactu code and the plugin never imports OpenMarket source; everything it uses comes from the `register(context)` API.

## Depends On (in OpenMarket core)
- Durable DomainEventBus (plan 01)
- Plugin loader: folder discovery, `plugin.json`, `register(context)`, `apiVersion`, `openmarket` version range, scoped bus (plan 02)
- Invoice aggregate (plan 03, PR #123) with: gap-free series + number, local issue date + timestamp with offset; stored line amounts and totals (never recomputed); per-line VAT rate and totals per rate (base, rate, quota) (#91); issuer NIF + name copied onto the invoice (#89); `InvoiceIssued` / `InvoiceCancelled` payloads carrying all of the above
- Receipt blocks / named UI slots so a plugin can add the QR + "VERI*FACTU" legend to the ticket (#105, #106)
- A settings slot for plugin config (from plan 02's Plugins page)

If any payload field is missing, add it to core first; the plugin must not query core tables.

## Repository layout
~~~text
plugin.json        (id "verifactu", version, openmarket ">=1.x <2", settings)
index.js           (CommonJS: module.exports = { register })
src/hash           (SHA-256 chain per AEAT spec)
src/xml            (RegistroAlta / RegistroAnulacion builders)
src/soap           (AEAT client mTLS, pruebas + production)
src/qr             (URL + QR per AEAT spec)
src/store          (verifactu_* tables + own migrations)
src/subscribers    (sync + durable handlers)
test/fakes         (fake bus, fake events, in-memory SQLite)
test/vectors       (official AEAT hash test vectors)
scripts/release.js (builds dist/verifactu/ and verifactu-<version>.zip)
~~~
- No runtime dependency on OpenMarket. Third-party deps (e.g. QR lib, XML/SOAP lib) are bundled into dist/verifactu/ so the folder is self-contained.
- CI: lint, tests, hash vectors, build the zip, attach to a GitHub release. Install = unzip into the plugins folder + restart.

## register(context)
- Check context.apiVersion === 1, otherwise throw a clear error (ends up in last_error).
- Run own migrations on context.connection (tables prefixed verifactu_, plus verifactu_schema_version row).
- eventBus.subscribeSync(events.InvoiceIssued, …) and (events.InvoiceCancelled, …)
- eventBus.subscribeDurable('verifactu:send', events.InvoiceIssued, …) (and cancellations), name prefixed with plugin id
- Register the receipt block (QR + legend) and settings fields.

## Synchronous subscriber (critical, inside the sale transaction)
- Fast, local, deterministic, no network.
- Reads the last registration (ORDER BY seq DESC LIMIT 1) on the same connection, computes the chained SHA-256 hash per AEAT spec.
- Builds the registration XML (alta, or anulación for cancellations).
- Inserts into verifactu_registration with status PENDING_SEND.
- A throw rolls back the whole sale + invoice, on purpose.

## Durable subscriber verifactu:send (delivery)
- Sends PENDING_SEND registrations via AEAT SOAP web service (mTLS with the configured certificate), in chain order.
- Idempotent: keyed by invoice_id; a retry never sends twice; handle AEAT "already registered" responses as success.
- Updates SENT (stores AEAT CSV) / FAILED; retries handled by the durable bus, dead after its limit.
- Environments: pruebas and production, from settings.

## Persistence (plugin-owned)
~~~sql
CREATE TABLE IF NOT EXISTS verifactu_registration (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL,
  kind TEXT NOT NULL,            -- ALTA | ANULACION
  previous_hash TEXT,
  hash TEXT NOT NULL,
  xml TEXT NOT NULL,
  status TEXT NOT NULL,          -- PENDING_SEND | SENT | FAILED
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  aeat_csv TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS verifactu_schema_version (version INTEGER NOT NULL);
~~~
Registrations are never updated (except delivery fields) nor deleted; add triggers.

## QR
- Built from invoice data + official URL format (AEAT QR spec).
- Rendered through the receipt block slot once the local registration exists.

## Configuration (plugin.json settings, shown on the Plugins page)
- Issuer NIF/name check (must match invoice), environment, software id + version, certificate path + password.
- Certificate stays on disk; store only its path; password in OS secure storage if core offers it, otherwise document the risk.

## Implementation Phases
1. Repo skeleton: plugin.json, register, migrations, fakes, release zip, CI
2. Hash implementation + official AEAT test vectors
3. Sync subscriber + transactional registration (alta + anulación)
4. SOAP delivery subscriber (pruebas), idempotency
5. QR + receipt block
6. Settings + certificate handling
7. End-to-end: install the zip into a real OpenMarket build, sell, verify the registration chain and delivery against AEAT pre-production

## Acceptance Criteria
- Installing = unzip into the plugins folder + restart; it appears on the Plugins page; incompatible core version shows a clear error and is skipped
- Issuing an invoice creates a valid chained registration before commit
- Hash matches official AEAT examples
- Sync failure prevents the invoice (and sale) from being persisted
- Delivery eventually succeeds or ends FAILED/dead, never sent twice
- OpenMarket core contains zero VeriFactu code; the plugin imports no core source
- Disabling the plugin needs confirmation; its tables and pending rows stay and resume when re-enabled

## Open question
Which Electron process runs plugins (main vs renderer). mTLS to AEAT and certificate reading need Node APIs, so the loader must provide them where plugins run. Resolve before phase 4.

## Official References
- AEAT developers: Sistemas Informáticos de Facturación y Sistemas VERI*FACTU
- Hash spec, QR spec, WSDL/XSD (use the latest published versions)
- RD 1007/2023 + Orden HAC/1177/2024
