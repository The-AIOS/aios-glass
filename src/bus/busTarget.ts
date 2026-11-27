import { resolveSessionName, resolveFormerName } from '../core/nameMatch';

/**
 * The session name a bus request addresses. A request to a LIVE session (send, kill, resume to a
 * live one) reaches it whatever its name's case: the registry's real name is used from here on
 * (shared core/nameMatch). A spawn creates the name, so it is left as written.
 * A kill to the name a session had before it was renamed reaches it (app#65): the current name
 * always wins, and the old one is used only when exactly one live session ever carried it. Only
 * the kill, as in the AIOS App.
 * Pure, so the rule is tested without an editor host.
 */
export function busTargetName(
  action: string,
  want: string,
  live: readonly { name: string; formerNames?: readonly string[] }[],
): string {
  if (action !== 'send' && action !== 'kill' && action !== 'resume') return want;
  const current = resolveSessionName(want, live.map((a) => a.name));
  if (current) return current;
  if (action === 'kill') return resolveFormerName(want, live) ?? want;
  return want;
}
