# openmarket-plugin-verifactu: rules for coding agents

OpenMarket plugin for AEAT VERI*FACTU. CommonJS, Node 24, `node:sqlite`, JSDoc + `checkJs` (no `.ts` files). Phases: `docs/PLAN.md`; one phase per PR, acceptance criteria in its GitHub issue. Host API: `docs/plugins.md` in UnexpectedSoftware/openMarket.

## Golden rules
1. **Never import OpenMarket source or query core tables.** Everything comes from `register(context)`: `apiVersion`, `eventBus` (`subscribeSync`, `subscribeDurable`, `ofType`), `connection.database`, `config`, `secrets`, `receipt`, `events`. A missing payload field gets added to core first.
2. **Sync handlers are local:** fast, deterministic, no network, no clock but the payload. A throw rolls the sale back on purpose.
3. **Network only in durable `verifactu:*` handlers**, idempotent by `invoice_id`; "already registered" is success.
4. **Tables are `verifactu_*`**, migrated only in `src/store/migrations.js`. Registrations are never deleted; only delivery fields change.
5. **Self-contained release:** runtime deps are bundled into `dist/verifactu/`; keep them few. `plugin.json` and `package.json` versions stay equal.

## Skill (load on demand)
- `verifactu-plugin`: recipes per phase (schema, sync handler, durable sender, receipt block, release) and the done-checklist. Load it before changing code.

## Commands
`npm ci`, `npm test`, `npm run typecheck`, `npm run build`. Never weaken, skip or delete a test to pass a gate.
