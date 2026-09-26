---
type: changed
---
**`jwksIdentity` reads a roles STRING as one role.** A roles claim holding `"Not neo-users"` used to be split on spaces into `Not` and `neo-users`, so a group name could satisfy a check for a role it does not name. A single string is now one role (an array still gives one role per entry). Pass `rolesFormat: 'space-delimited'` to keep the old reading for a claim that really is a space-delimited list, such as an OAuth `scope` read as roles. `rolesClaim` also takes a path, `['realm_access', 'roles']`, for nested roles.
