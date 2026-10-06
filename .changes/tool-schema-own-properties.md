---
type: fixed
---
**Tool argument validation uses own properties consistently.** Inherited values
no longer satisfy required arguments or trigger optional-field checks. An
undeclared argument named `constructor`, `toString` or `__proto__` no longer
evades a closed schema, while explicitly declared names remain valid. Closing
an object without a `properties` map now permits no extra keys, including in
nested objects and argument-value checks.

The validator remains a JSON Schema subset. Malformed property maps and
nonempty or malformed `patternProperties` defer extra-key rejection because
the validator cannot determine their name coverage; independent required and
declared-property checks remain active. This also removes previous false
extra-key refusals for such schemas, without implementing pattern properties.

Migration: supply required values as own fields and explicitly declare intended
keys in closed schemas. Do not rely on the prototype chain as an argument or
schema declaration. For complete pattern-property enforcement, validate in the
tool with a full schema implementation. Arguments are not copied or rewritten;
Agent enforce/warn/off behavior and the existing enumeration boundary remain.
