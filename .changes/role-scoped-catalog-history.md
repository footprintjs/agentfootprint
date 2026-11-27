---
type: security
---
Apply the current skill access policy when showing catalog results and saved catalog history. Model-authored replies remain part of the conversation. Applications that require those replies to be removed after a role change should start a fresh conversation.

Conversation checkpoints now use version 2. A governed restore withholds older catalog results whose origin is unknown.
The private catalog provenance also travels with newly saved results from agents without a checker and is omitted from provider requests.
A withheld result becomes a generic placeholder that carries no catalog names or descriptions.
