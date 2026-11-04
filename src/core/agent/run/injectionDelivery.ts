import type { Injection } from '../../../injection-engine/types.js';
import { assertDeliverableRole } from '../stages/deliver.js';
import { messagesContentRefusal } from '../../../injection-engine/messagesSlotRefusal.js';

/** Validate every declared injected message against the actual run provider set. */
export function assertInjectionDelivery(
  injections: readonly Injection[],
  providers: Parameters<typeof assertDeliverableRole>[0],
): void {
  for (const inj of injections) {
    for (const msg of inj.inject?.messages ?? []) {
      assertDeliverableRole(providers, msg.role, `Agent injection '${inj.id}'`);
      // Content, judged at the same funnel as role (8.18.0). The named
      // factories refuse empty content; a hand-built Injection reached the
      // delivery stage unchecked and put a contentless turn on the wire.
      const content = msg.content as unknown;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error(
          messagesContentRefusal({
            site: `Agent injection '${inj.id}'`,
            role: msg.role,
            received:
              typeof content !== 'string'
                ? content === undefined
                  ? 'missing'
                  : `a ${content === null ? 'null' : typeof content}`
                : 'empty',
          }),
        );
      }
    }
  }
}
