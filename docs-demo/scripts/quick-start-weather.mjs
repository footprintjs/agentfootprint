// Both locks exercise this fixture with their own Agent and mock implementations.
export const weatherInput = 'Weather in San Francisco?';
export const weatherAnswer = 'Got it — San Francisco: sunny, 72°F.';

export function buildWeatherAgent({ Agent, mock }, structureRecorders) {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-weather-1', name: 'weather', args: { city: 'San Francisco' } }] },
        { content: weatherAnswer },
      ],
    }),
    model: 'mock',
    maxIterations: 5,
    // The LLM call exposes the system, messages and tools slots as a subflow.
    reactMode: 'dynamic-grouped',
    structureRecorders,
  })
    .system('You answer weather questions using the `weather` tool.')
    .tool({
      schema: {
        name: 'weather',
        description: 'Get current weather for a city.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      execute: async (args) => `${args.city}: sunny, 72°F`,
    })
    .build();
}
