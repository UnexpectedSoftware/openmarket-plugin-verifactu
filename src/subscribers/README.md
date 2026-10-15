# src/subscribers

Sync handlers (phase 3) run inside the sale transaction: fast, local, no network; a throw rolls back the sale. The durable `verifactu:send` handlers (phase 4) do all network work.
