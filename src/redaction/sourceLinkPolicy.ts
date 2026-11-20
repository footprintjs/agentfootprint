import type { LogAddress } from 'foottrace';
import type { SourceLinkPolicy } from 'foottrace/cause';
import { pathSegments } from 'foottrace/paths';
import type { RedactionPolicy } from 'footprintjs';
import { RedactionRule } from 'footprintjs/advanced';
import { carryPrivateRuleNames } from './privateRun.js';

/** Retained native policy grants, tied to the served snapshot object and never serialized. */
const snapshotGrants = new WeakMap<object, SourceLinkPolicy>();

export function keepSnapshotSourceLinkGrant<T extends object>(
  snapshot: T,
  grant: SourceLinkPolicy | undefined,
): T {
  if (grant !== undefined) snapshotGrants.set(snapshot, grant);
  return snapshot;
}

export function sourceLinkGrantOfSnapshot(snapshot: object): SourceLinkPolicy | undefined {
  return snapshotGrants.get(snapshot);
}

/** A field-selected ancestor can hide every leaf below that field. */
export function ruleShowsPath(rule: RedactionRule, path: readonly string[]): boolean {
  if (path.length === 0) return false;
  for (let depth = 1; depth < path.length; depth++) {
    if (rule.verdict(path.slice(0, depth)).kind === 'whole') return false;
  }
  return rule.verdict([...path]).kind === 'clear';
}

/** The exact locator is already narrowed by Foottrace before it asks its host. */
export function sourceLinkPolicyOfRule(address: LogAddress, rule: RedactionRule): SourceLinkPolicy {
  return (locator, context) => {
    if (
      context.signal.aborted ||
      address.logRunId !== locator.address.logRunId ||
      address.drillPath.length !== locator.address.drillPath.length ||
      address.drillPath.some((segment, index) => segment !== locator.address.drillPath[index])
    )
      return false;
    const path = pathSegments(locator.key);
    if (locator.element !== undefined) path.push(String(locator.element));
    if (locator.pointer !== undefined && locator.pointer !== '') {
      path.push(
        ...locator.pointer
          .slice(1)
          .split('/')
          .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~')),
      );
    }
    return ruleShowsPath(rule, path);
  };
}

/**
 * A settled run's rule as its serving keeps it: the policy and the marks —
 * names only — and nothing else of the run. footprintjs's rule also remembers
 * the masked form of every thrown value it served (so `onRunFailed`, the
 * logger and a fork envelope agree); the live run needed that, a late fact
 * does not, and keeping it would keep each run's thrown values reachable for
 * as long as the dispatcher keeps the run's serving.
 *
 * @internal — exported for the test that pins it.
 */
export function retiredRule(
  rule: RedactionRule,
  policy: RedactionPolicy | undefined,
): RedactionRule {
  const names = new RedactionRule(policy);
  const marks = rule.marksForCheckpoint();
  if (marks !== undefined) names.restoreMarks(marks);
  carryPrivateRuleNames(rule, names);
  return names;
}
