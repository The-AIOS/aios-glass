/**
 * Request fields another surface implements and Glass does not. Contract 2 has the surfaces RACE,
 * so a field Glass ignored would be honoured or dropped depending on which watcher fired first.
 * Glass refuses instead: the request is dead-lettered naming the field, never fulfilled without it.
 *
 * `cwd` (App PR #77) — the directory a spawned or resumed session's terminal opens in. Glass opens
 * every session in the framework root, so a request carrying `cwd` that Glass won ran silently in
 * the wrong folder.
 *
 * `addDirs` (App PR 89) — extra directories granted with `--add-dir`. Same reason: a session Glass started without
 * them looks like one that has them until it stalls on a read nobody is there to approve.
 */
export function unsupportedFieldReason(req: Record<string, unknown>, action: string): string | undefined {
  if ((action === 'spawn' || action === 'resume') && req.cwd !== undefined && req.cwd !== null) {
    return 'this surface does not support cwd; send with "surface":"app"';
  }
  if ((action === 'spawn' || action === 'resume') && req.addDirs !== undefined && req.addDirs !== null) {
    return 'this surface does not support addDirs; send with "surface":"app"';
  }
  return undefined;
}
