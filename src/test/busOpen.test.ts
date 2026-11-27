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
  assert.match(prep, /looksLikeFramework\(openRoots\[0\]\.real\)/);
  assert.match(ext, /prepareOpenRoots\(\);   \/\/ contract 5: the root is resolved once, here/);
  assert.match(runOpen, /if \(openOff\) \{ releaseRequest\(held, true,/);
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
  assert.equal((flood.match(/releaseRequest\(held, true,/g) ?? []).length, 1);
  assert.match(flood, /else releaseRequest\(held, false\);/);
});

test('what is shown is the checked file\'s bytes, from a read-only file system that never reloads', () => {
  assert.match(runOpen, /readChecked\(d\.path, d\.identity, \{ roots: openRoots, asBytes: asset \}\)/);
  assert.match(runOpen, /const uri = snapshots\.add\(d\.path, bytes, d\.name\);/);
  assert.doesNotMatch(runOpen, /Uri\.file\(|markdown\.showPreview/, 'never the real file, never a preview that loads what the note points at');
  assert.match(ext, /registerFileSystemProvider\(SNAPSHOT_SCHEME, snapshots, \{\s*isCaseSensitive: true,\s*isReadonly: new vscode\.MarkdownString\(t\(/);
  for (const w of ['writeFile', 'delete', 'rename', 'createDirectory']) {
    assert.match(snap, new RegExp(`${w}\\(uri: vscode\\.Uri\\): void \\{ throw vscode\\.FileSystemError\\.NoPermissions\\(uri\\); \\}`), `${w} is refused`);
  }
  assert.match(snap, /watch\(\): vscode\.Disposable \{ return new vscode\.Disposable\(\(\) => \{ \/\* a snapshot never changes \*\/ \}\); \}/);
  assert.match(snap, /permissions: vscode\.FilePermission\.Readonly/);
});

test('the keyboard never moves and nothing is handed to the desktop', () => {
  assert.equal((runOpen.match(/preserveFocus: true/g) ?? []).length, 2, 'both the text and the image path keep the focus');
  for (const banned of ['openExternal', 'revealFileInOS', 'env.open', 'focus()', 'workbench.action.focus']) {
    assert.ok(!runOpen.includes(banned), `runOpen must not use ${banned}`);
  }
});

test('"Open to edit" closes the copy and opens the real file the operator\'s own way', () => {
  const cmd = between(ext, "registerCommand('aios.openSnapshotForEdit'", '\n    }),');
  assert.match(cmd, /snapshots\.realPathOf\(uri\)/);
  assert.match(cmd, /executeCommand\('vscode\.open', vscode\.Uri\.file\(real\)\)/);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const menu = pkg.contributes.menus['editor/title'].find((m: { command: string }) => m.command === 'aios.openSnapshotForEdit');
  assert.equal(menu?.when, 'resourceScheme == aios-open', 'the button shows on a snapshot only');
  for (const f of ['package.nls.json', 'package.nls.es.json', 'package.nls.fr.json', 'package.nls.el.json', 'package.nls.pt-br.json']) {
    assert.ok(JSON.parse(fs.readFileSync(f, 'utf8'))['cmd.openSnapshotForEdit'], `${f} names the button`);
  }
});

test('the read-only notice and the gone-copy notice are translated', () => {
  const keys = ['A session opened this file, so it is read only here. To write in it, use "Open to edit" in the title bar.',
    'This copy is no longer available. Open the file from the explorer.'];
  for (const loc of ['es', 'fr', 'el', 'pt-br']) {
    const j = JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${loc}.json`, 'utf8')) as Record<string, string>;
    for (const k of keys) assert.ok(j[k] && j[k] !== k, `${loc}: ${k.slice(0, 30)}…`);
  }
});
