# AgentFootprint 20.1.0 listed-skill checkpoints

The independent #539 review saved each checkpoint from a real 20.1.0 agent
using a scripted Anthropic client with no network. The script called `t1`,
then `read_skill('aa')`, then paused inside `aa_tool` after the body had
already reached the model. These files contain the checkpoint from each
capture, with JSON whitespace expanded. No state keys were rewritten.

- `bound.json`: source capture SHA-256 `61b31c13c60181d17dc74cbe5d42081dbb0fcb850067b4b0021ff8622f0a926e`.
- `unknown.json`: source capture SHA-256 `43454aacbd0c67913c693b30d995457f9907a1c74d2306993732edbc913767dd`.
