---
type: changed
---
**`jwksIdentity` reads a roles STRING as one role.** A roles claim holding `"Not app-users"` used to be split on spaces into `Not` and `app-users`, so a group name could satisfy a check for a role it does not name. A single string is now one role, taken as given — no longer trimmed, so `" admin "` is the role `" admin "` (an array still gives one role per entry). `rolesClaim` also takes a path, `['realm_access', 'roles']`, for nested roles.

Migration: if your roles claim really is ONE space-delimited string (for example an OAuth `scope` read as roles), pass `jwksIdentity({ rolesFormat: 'space-delimited' })` to keep the old split. A roles claim that is an array, or a single role name, needs no change. A role check that relied on surrounding spaces being trimmed must compare the exact string the token carries.
