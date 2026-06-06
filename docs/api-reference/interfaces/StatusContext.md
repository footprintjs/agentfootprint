[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StatusContext

# Interface: StatusContext

Defined in: [src/recorders/observability/status/statusTemplates.ts:66](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L66)

Render context — what the consumer's app config injects.

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/recorders/observability/status/statusTemplates.ts:68](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L68)

Active actor's name. Substituted as `{{appName}}` in templates.
