[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isSaidByPerson

# Function: isSaidByPerson()

> **isSaidByPerson**(`msg`): `boolean`

Defined in: [src/lib/saidByPerson.ts:165](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/lib/saidByPerson.ts#L165)

THE rule: true when this message is something a PERSON said.

Deliberately narrow, and narrow in one direction: a message we are not sure
about is not credited to a person. The exclusions are the ways this library
authors a user turn — a delivery marker its own stage stamps, and the frames
in [LIBRARY\_AUTHORED\_PREFIXES](/agentfootprint/api/generated/variables/LIBRARY_AUTHORED_PREFIXES.md) — never a guess at prose.

A message from a restored conversation, a hand-built window, or a person
typing passes every exclusion and is theirs.

## Parameters

### msg

[`AuthoredMessage`](/agentfootprint/api/generated/interfaces/AuthoredMessage.md) \| `undefined`

## Returns

`boolean`
