# Code runner output

Role: Lens.

The code-runner facade uses these pure functions to preserve stdout, stderr,
and exit wording while measuring what the clip retains. A count uses the
same UTF-16 units as the model-facing clip and covers the two printed streams.
An upstream runner that reports one maximum for two clipped streams leaves
the original combined size unknown. The tests pin the rendering and counts.
