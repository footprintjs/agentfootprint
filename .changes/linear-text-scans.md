---
type: security
---
**Untrusted text is scanned in one pass where a regex used to take its length squared.** Several
doors trimmed or scanned text the library does not write with regular expressions that a
backtracking engine retries from every position, so one crafted input cost its length squared —
seconds for a few dozen KB, minutes for a megabyte, with the process blocked throughout. Each is
now a single pass that returns exactly what the regex returned: the RAG Markdown splitter's
heading lines (`byHeading`), the HTML loader's tag stripping (`htmlLoader` / `stripTags`), the
code runner's call shape (`codeShape`, run on model-written code), the evidence matcher's token
cleanup, the constrained-pick reply parser, the pattern fact extractor's address rule and value
cleanup, the coverage section's trim of the model's answer, the time layer's clock tokens,
place-named zones (`London time`) and the English reader's `between` check (which re-read the
whole message before every time phrase in it), the SKOS reader's IRI query strip, the LDAP door's
PEM reader, and the base-URL and prefix trims in the Ollama, Foundry, Foundry Local, Azure OpenAI,
InvokeModel gateway, Vault, OIDC discovery, GitHub bug-report and device sign-in, TypeSafe and
artifact-prefix options.

`stripTags` also ends a `<script>` or `<style>` body at the end tags a browser ends it at —
`</script foo>`, `</script/>` — where it used to leave that body in the extracted text. As in a
browser, a blank other than tab, LF, FF, CR or space after `</script` (U+00A0, U+2028 …) no longer
ends the tag. The runbook verdict table escapes backslashes as well as pipes, so markdown shows a
value's backslashes as written (`a\_b` used to render as `a_b`).
