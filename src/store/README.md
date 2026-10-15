# src/store

Plugin-owned tables (`verifactu_*`) and their migrations. Rows of `verifactu_registration` are never deleted and only delivery fields (status, attempts, last_error, aeat_csv, sent_at) may change; triggers enforce it.
