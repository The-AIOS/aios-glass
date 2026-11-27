import { resolveSessionName } from '../core/nameMatch';

/**
 * The session name a bus request addresses. A request to a LIVE session (send, kill, resume to a
 * live one) reaches it whatever its name's case: the registry's real name is used from here on
 * (shared core/nameMatch). A spawn creates the name, so it is left as written.
 * Pure, so the rule is tested without an editor host.
 */
export function busTargetName(
  action: string,
  want: string,
  live: readonly { name: string }[],
): string {
  if (action !== 'send' && action !== 'kill' && action !== 'resume') return want;
  return resolveSessionName(want, live.map((a) => a.name)) ?? want;
}
