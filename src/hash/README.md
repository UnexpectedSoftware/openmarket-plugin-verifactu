# src/hash

SHA-256 chain for each registration, per AEAT *Detalle de las especificaciones técnicas para la generación de la huella* v0.1.2. Pure functions (`node:crypto` only). Official examples live in `test/vectors/aeat-huella.json`.

`hashRegistroAlta` / `registroAltaInput` — `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`, `ImporteTotal`, `Huella`, `FechaHoraHusoGenRegistro`.

`hashRegistroAnulacion` / `registroAnulacionInput` — `IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`, `FechaExpedicionFacturaAnulada`, `Huella`, `FechaHoraHusoGenRegistro`.

Pass the exact characters that will be written in the XML (amounts are not reformatted; `12.35` and `12.350` hash differently). Dates stay `DD-MM-YYYY` and `YYYY-MM-DDTHH:MM:SS±HH:MM`. The first record uses an empty `Huella`. `TIPO_HUELLA` is `01` and is not part of the hashed string.
