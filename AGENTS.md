# openmarket-plugin-verifactu: rules for coding agents

OpenMarket plugin (CommonJS, Node 24, `node:sqlite`). Plan and phases: `docs/PLAN.md`. Workflow: `.grok/skills/verifactu-plugin/SKILL.md`.

## Golden rules
1. **Never import OpenMarket source.** Everything comes from `register(context)`: `apiVersion`, `eventBus` (`subscribeSync`, `subscribeDurable`, `ofType`), `connection.database`, `config`, `events`. If a field is missing from an event payload, it must be added to OpenMarket core first; never query core tables.
2. **Sync handlers are local.** `subscribeSync` runs inside the sale transaction: fast, deterministic, no network, no file I/O beyond the shared connection. A throw rolls back the sale on purpose.
3. **Network only in durable handlers** (`verifactu:send…`). They must be idempotent (keyed by `invoice_id`) and treat "already registered" as success.
4. **Tables are prefixed `verifactu_`** and migrated by `src/store/migrations.js` (bump `SCHEMA_VERSION`, keep migrations idempotent). Registrations are never deleted and only delivery fields change; don't weaken the triggers.
5. **JSDoc + `checkJs`, no TypeScript files.** `npm run typecheck` must pass.
6. **Self-contained release.** Runtime deps get bundled into `dist/verifactu/`; keep them few.

## Layout
`index.js` (register) · `src/store` · `src/subscribers` · `src/hash` · `src/xml` · `src/soap` · `src/qr` · `test/fakes` · `test/vectors` · `scripts/release.js`

## Before you say you're done
`npm test && npm run typecheck && npm run build`. Keep `plugin.json` and `package.json` versions equal.
