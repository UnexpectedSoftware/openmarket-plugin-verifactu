# src/xml

Builders for `RegistroAlta` and `RegistroAnulacion` (SuministroInformacion, `IDVersion` 1.0). No SOAP envelope.

Amounts use two decimal places via `formatAmount` (integer cents, no floating point). Expedition dates are `DD-MM-YYYY`. The text nodes of the hashed fields are the exact strings passed to `src/hash`. `TipoHuella` is `01`.
