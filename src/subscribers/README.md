# src/subscribers

`subscribeSync` handlers run inside the sale transaction. They read the last `verifactu_registration`, hash it with `src/hash`, build the registro with `src/xml`, and insert `PENDING_SEND`. No network and no clock other than the event payload. A throw rolls the sale back.

`InvoiceIssued` inserts an `ALTA`. `InvoiceCancelled` inserts an `ANULACION` chained to the previous registration, and only if that invoice already has an alta.

The durable `verifactu:send` handlers (phase 4) do all network work.
