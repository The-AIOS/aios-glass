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
  /* An empty list means "no extra folders" on the App, so it is not a field Glass would have to drop (review, 0.14.0). */
  if ((action === 'spawn' || action === 'resume') && req.addDirs !== undefined && req.addDirs !== null && !(Array.isArray(req.addDirs) && req.addDirs.length === 0)) {
    return 'this surface does not support addDirs; send with "surface":"app"';
  }
  return undefined;
}

/**
 * `group` (App 0.15.0) — the tab group a spawned or resumed session joins, by name. Glass terminals
 * have no tab groups. Unlike `cwd` and `addDirs` this is ADVISORY: a worker started outside its
 * group is still the right worker in the right folder, so the field is never a reason to refuse.
 * When the App is alive, the request goes to the App, which honours it; otherwise Glass starts the
 * session and logs that the group was not applied. Returns the group name when it is worth handing
 * over, or undefined (absent, not a string, empty, or a verb that launches nothing).
 */
export function appPreferredGroup(req: Record<string, unknown>, action: string): string | undefined {
  if (action !== 'spawn' && action !== 'resume') return undefined;
  const g = req.group;
  if (typeof g !== 'string') return undefined;
  const s = g.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 40) : undefined;
}
