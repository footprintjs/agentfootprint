**Fold** — resolves simple prose markers within the accepted request's offer.

Only marker suffixes on prose sentences and list items count. Code, markup
whose bracket associations cannot be established, and unsupported layouts stay
literal. A claim span carries offsets into the answer and slot references, with
no copy of the answer or submitted result. Lookup never searches another offer.

The shared prose scanner supplies inline code spans. The collector excludes
markers in those spans before counting or resolving references. If the scanner
cannot account for the delimiters in a block, that block stays literal.
Fenced examples stay literal through blank lines and list or quote containers.
Only unfenced lines can introduce a reference definition that makes a citation
marker ambiguous.
