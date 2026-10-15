# openmarket-plugin-verifactu

VeriFactu (AEAT, Spain) compliance as a drop-in plugin for [OpenMarket](https://github.com/UnexpectedSoftware/openMarket). It chains every invoice registration with SHA-256, adds the QR and "VERI*FACTU" legend to the ticket, and sends the registrations to the AEAT. OpenMarket core contains no VeriFactu code; this plugin uses only the `register(context)` API described in OpenMarket's [`docs/plugins.md`](https://github.com/UnexpectedSoftware/openMarket/blob/master/docs/plugins.md).

> **Status: phase 1 — skeleton.** The plugin loads, checks the API version, creates its tables and registers stub subscribers. It does **not** yet compute hashes, build XML, send to the AEAT or print a QR. Do not use it for compliance yet. See [docs/PLAN.md](docs/PLAN.md) for the phases.

## Install
1. Download `verifactu-<version>.zip` from the [releases](https://github.com/UnexpectedSoftware/openmarket-plugin-verifactu/releases).
2. Unzip it so the folder lands at `<userData>/plugins/verifactu/` (on Linux `~/.config/OpenMarket/plugins/verifactu/`; the Plugins page shows the exact path).
3. Restart OpenMarket, enable **VeriFactu** on the Plugins page, fill in its settings and restart again.

Requires OpenMarket `>=1.15.0 <2` with invoices (`InvoiceIssued` / `InvoiceCancelled` events).

## Develop
~~~bash
npm ci            # Node 24+
npm test          # node:test, in-memory SQLite fakes
npm run typecheck # JSDoc checked by tsc (no TypeScript sources)
npm run build     # dist/verifactu/ + dist/verifactu-<version>.zip
~~~
Tag `v<version>` (matching `plugin.json` and `package.json`) to publish a release with the zip.

## License
Apache-2.0, as OpenMarket's `LICENSE` file.
