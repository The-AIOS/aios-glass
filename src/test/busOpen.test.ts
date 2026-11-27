/**
 * The spawn-inbox `open` verb (contract 5) in Glass: the wiring around the shared decision.
 *
 * The decision itself (@the-aios/core/openRequest) is tested in the shared package against the
 * framework's conformance fixture. The extension and the snapshot file system import `vscode`, so
 * these read the source and assert the seams: the verb reaches the shared decision on the framework
 * root alone, prepared once; what is shown is the bytes read from the checked file, served read only
 * from Glass's own file system; nothing reloads it; the keyboard never moves; and "Open to edit" is
 * the operator's own open.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

const ext = fs.readFileSync('src/extension.ts', 'utf8');
const snap = fs.readFileSync('src/bus/openSnapshot.ts', 'utf8');
const between = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from); const b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `markers not found: ${from} … ${to}`);
  return src.slice(a, b);
};
const runOpen = between(ext, 'const runOpen = async (', '\n  const consumeSpawnRequest = async (');

test('open goes to the shared decision before the name check (the name is who asks; the decision checks it)', () => {
  const at = ext.indexOf("if (action === 'open') { await runOpen(held, req as Record<string, unknown>, seen); return; }");
  const name = ext.indexOf('if (!name) { releaseRequest(held, true, "missing \'name\'"); return; }');
  assert.ok(at > 0 && name > at);
  assert.match(ext, /this surface implements spawn, kill, send, resume and open\./);
});

test('the root is the framework root alone, prepared once when the bus starts, and open is off without one', () => {
  const prep = between(ext, 'const prepareOpenRoots = (): void => {', '\n  };');
  assert.match(prep, /prepareRoots\(\[fw\], os\.homedir\(\)\)/);
  assert.doesNotMatch(prep, /workspace|WORKSPACE|stateGet/, 'the workspace-folder list is session-writable and is not a root');
  assert.match(prep, /without vault\/ and plugins\/aios\/\); it is read when the window starts/, 'the dead letter says why, and that a reload re-reads it');
  assert.match(ext, /prepareOpenRoots\(\);   \/\/ contract 5: the root is resolved once, here/);
  assert.match(runOpen, /d\.why === 'unavailable' && openOff/, 'open off answers at check 8, after the flood and rate counting');
  assert.doesNotMatch(runOpen.slice(0, runOpen.indexOf('decideOpen(')), /releaseRequest/, 'nothing is refused before the decision counts it');
});

test('the decision gets this window\'s own clock and counts every request but a too-old one', () => {
  assert.match(runOpen, /decideOpen\(\{ body, seenAgoMs: seen\.seenAgoMs, presentAtStart: seen\.atStart, nowMs: now, roots: openRoots, decided: decidedOpens \}\)/);
  assert.match(runOpen, /if \(d\.do === 'open' \|\| d\.counted\) decidedOpens = rememberDecided\(/);
  assert.match(ext, /if \(!prior \|\| prior\.ino !== ino\) \{ firstSeen\.set\(fsPath, \{ ino, at: Date\.now\(\) \}\);/, 'keyed by inode: a new request under an old name');
  assert.match(ext, /let seen = \{ seenAgoMs: Infinity, atStart: true \};   \/\/ an adopted hold/, 'an adopted hold is late by definition');
  assert.match(ext, /if \(draining\) presentAtStart\.add\(fsPath\);/);
  const drain = between(ext, 'draining = true;', 'draining = false;');
  assert.match(drain, /consumeSpawnRequest\(path\.join\(spawnInboxDir, f\)\)/);
});

test('a flood writes one dead letter a minute, not one per request', () => {
  const flood = between(runOpen, "if (d.why === 'flood') {", '\n      }');
  assert.doesNotMatch(flood, /releaseRequest\(held, true,/, 'no dead letter per request, and no request file becomes the notice');
  assert.match(flood, /releaseRequest\(held, false\);\s*if \(!floodTimer\) floodTimer = setTimeout\(flushFlood, 60_000\);/, 'each goes at once; one notice at the end of the minute');
  const flush = between(ext, 'const flushFlood = (): void => {', '\n  };');
  assert.match(flush, /path\.join\(spawnInboxDir, `open-flood-\$\{Date\.now\(\)\}-\$\{process\.pid\}\.json\.undelivered`\)/, 'under a name of its own');
  assert.match(flush, /\$\{n\} open request\(s\) dropped in the last minute/, 'with the full count');
  assert.match(ext, /context\.subscriptions\.push\(\{ dispose: flushFlood \}\);/, 'and when the window closes');
  assert.match(ext, /if \(verdict === 'skip'\) \{ firstSeen\.delete\(fsPath\); presentAtStart\.delete\(fsPath\); return; \}/, 'no first-seen entry outlives a request this window will not take');
});

test('what is shown is the checked file\'s bytes, from a read-only file system that never reloads', () => {
  assert.match(runOpen, /readChecked\(d\.path, d\.identity, \{ roots: openRoots, asBytes: asset \}\)/);
  assert.match(runOpen, /const uri = snapshots\.add\(\{ real: d\.path, bytes, by: d\.name, identity: d\.identity, asset \}\);/);
  assert.match(runOpen, /if \(\/\\\.pdf\$\/i\.test\(d\.path\)\) \{ releaseRequest\(held, true, 'open refused \(unreadable\)/, 'no viewer of its own for PDF: refused, never handed to another extension');
  assert.match(runOpen, /executeCommand\('vscode\.openWith', uri, 'imagePreview\.previewEditor'/, 'images in VS Code\'s own preview only');
  assert.match(snap, /const MAX_BYTES = 256 \* 1024 \* 1024;/);
  assert.match(snap, /this\.items\.size > MAX_SNAPSHOTS \|\| \(this\.bytes > MAX_BYTES/);
  assert.match(snap, /private readonly activation = crypto\.randomBytes\(4\)/, 'a tab restored after a reload never shows a new snapshot');
  assert.match(ext, /setTimeout\(\(\) => \{ if \(!snapshotTabs\(\)\.some\(\(x\) => tabUri\(x\)\?\.path === u\.path\)\) snapshots\.drop\(u\.path\); \}, 0\);/, 'bytes go when no tab shows them any more (a move reports a close too)');
  assert.match(snap, /const victim = \[\.\.\.this\.items\.keys\(\)\]\.find\(\(k\) => k !== key && !shown\.has\(k\)\)/, 'the bound evicts a snapshot no tab shows first');
  assert.match(ext, /void vscode\.window\.tabGroups\.close\(snapshotTabs\(\)\)/, 'restored snapshot tabs are closed at start');
  assert.doesNotMatch(runOpen, /Uri\.file\(|markdown\.showPreview/, 'never the real file, never a preview that loads what the note points at');
  assert.match(ext, /registerFileSystemProvider\(SNAPSHOT_SCHEME, snapshots, \{\s*isCaseSensitive: true,\s*isReadonly: new vscode\.MarkdownString\(t\(/);
  for (const w of ['writeFile', 'delete', 'rename', 'createDirectory']) {
    assert.match(snap, new RegExp(`${w}\\(uri: vscode\\.Uri\\): void \\{ throw vscode\\.FileSystemError\\.NoPermissions\\(uri\\); \\}`), `${w} is refused`);
  }
  assert.match(snap, /watch\(\): vscode\.Disposable \{ return new vscode\.Disposable\(\(\) => \{ \/\* a snapshot never changes \*\/ \}\); \}/);
  assert.match(snap, /permissions: vscode\.FilePermission\.Readonly/);
});

test('the keyboard never moves and nothing is handed to the desktop', () => {
  assert.equal((runOpen.match(/preserveFocus: true, viewColumn \}/g) ?? []).length, 2, 'both the text and the image path keep the focus');
  assert.match(runOpen, /const activeTab = vscode\.window\.tabGroups\.activeTabGroup\.activeTab;\s*const viewColumn = activeTab && tabUri\(activeTab\)\?\.scheme !== SNAPSHOT_SCHEME \? vscode\.ViewColumn\.Beside : undefined;/, 'never into the group of whatever tab is in use, a webview or a terminal included');
  for (const banned of ['openExternal', 'revealFileInOS', 'env.open', 'focus()', 'workbench.action.focus']) {
    assert.ok(!runOpen.includes(banned), `runOpen must not use ${banned}`);
  }
});

test('"Open to edit" closes the copy and opens the real file the operator\'s own way', () => {
  const cmd = between(ext, "registerCommand('aios.openSnapshotForEdit'", '\n    }),');
  assert.match(cmd, /const again = readChecked\(snap\.real, snap\.identity, \{ roots: openRoots, asBytes: snap\.asset \}\);\s*if \(!again\.ok\)/, 'the real file is checked again first');
  assert.ok(cmd.indexOf('readChecked(') < cmd.indexOf("'vscode.open'"));
  assert.match(cmd, /if \(tab\) await vscode\.window\.tabGroups\.close\(tab\);/, 'the snapshot tab itself is closed');
  assert.ok(cmd.indexOf("'vscode.open'") < cmd.indexOf('tabGroups.close(tab)'), 'after the real file opens, so no column renumbers under it');
  assert.doesNotMatch(cmd, /closeActiveEditor/, 'never "the active editor": in a split view that is the operator\'s own file');
  assert.match(cmd, /executeCommand\('vscode\.open', vscode\.Uri\.file\(snap\.real\), \{ viewColumn: column \}\)/);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const menu = pkg.contributes.menus['editor/title'].find((m: { command: string }) => m.command === 'aios.openSnapshotForEdit');
  assert.equal(menu?.when, 'resourceScheme == aios-open', 'the button shows on a snapshot only');
  for (const f of ['package.nls.json', 'package.nls.es.json', 'package.nls.fr.json', 'package.nls.el.json', 'package.nls.pt-br.json']) {
    assert.ok(JSON.parse(fs.readFileSync(f, 'utf8'))['cmd.openSnapshotForEdit'], `${f} names the button`);
  }
});

test('the read-only notice and the gone-copy notice are translated', () => {
  const keys = ['A session opened this file, so it is read only here. To write in it, use "Open to edit" in the title bar.',
    'This copy is no longer available. Open the file from the explorer.',
    'The file changed since this copy was taken, so it was not opened. Open it from the explorer if you want it.'];
  for (const loc of ['es', 'fr', 'el', 'pt-br']) {
    const j = JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${loc}.json`, 'utf8')) as Record<string, string>;
    for (const k of keys) assert.ok(j[k] && j[k] !== k, `${loc}: ${k.slice(0, 30)}…`);
  }
});
