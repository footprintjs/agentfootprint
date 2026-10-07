---
type: security
---
**Untrusted text can no longer stall the event loop through a quadratic regex.** Several doors
trimmed or scanned text the library does not write with regular expressions that a backtracking
engine retries from every position, so one crafted input cost its length squared — seconds for a
few dozen KB, minutes for a megabyte, with the process blocked throughout. Each is now a single
pass that returns exactly what the regex returned: the RAG Markdown splitter's heading lines
(`byHeading`), the HTML loader's tag stripping (`htmlLoader` / `stripTags`), the code runner's
call shape (`codeShape`, run on model-written code), the evidence matcher's token cleanup, the
constrained-pick reply parser, the pattern fact extractor's address rule and value cleanup, the
LDAP door's PEM reader, and the base-URL and prefix trims in the Ollama, Foundry, Foundry Local,
Azure OpenAI, InvokeModel gateway, Vault, OIDC discovery, GitHub bug-report and device sign-in,
TypeSafe and artifact-prefix options. `stripTags` also ends a `<script>` or `<style>` body at
every end tag a browser ends it at — `</script foo>`, `</SCRIPT\n>` — where it used to leave the
body in the extracted text. A runbook verdict table now escapes a backslash before a pipe, so a
value cannot open a new column.
