# Construction configuration

`read.ts` reads options and validates them before a host is served. It owns the
single spend ledger and artifact operation counter passed to the other owners.
Validation and construction effects remain in their original order. Tests pin
refusal before host effects and the explicit unbounded artifact setting.
