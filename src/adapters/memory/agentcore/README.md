**Support** — escape one AgentCore identity segment.

`escapeIdSegment.ts` holds the existing UTF-16 code-unit encoder used by `../agentcore.ts`; its verbatim-character regex stays private.

The law: preserve the existing verbatim alphabet and encode every other code unit with the caller's introducer and four uppercase hexadecimal digits, including introducers and lone surrogates.
