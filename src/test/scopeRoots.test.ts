/* The roots of the operator's scope: the framework, the App's workspace folders and this window's,
   never a folder too broad to be a workspace (the App rule). The-AIOS/aios-app#226. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tooBroadFolder, appWorkspaceFolders, scopeRoots, sessionsUnder, parsePidTable } from '../agents/scopeRoots';

test('a folder too broad to be a workspace never becomes a root (the App rule)', () => {
  const home = '/Users/op';
  assert.equal(tooBroadFolder('/', home, 'darwin'), 'root');
  assert.equal(tooBroadFolder('/Users/op', home, 'darwin'), 'home');
  assert.equal(tooBroadFolder('/Users', home, 'darwin'), 'aboveHome');
  assert.equal(tooBroadFolder('/Volumes/Disk', home, 'darwin'), 'volume');
  assert.equal(tooBroadFolder('/tmp/x', home, 'darwin'), 'temporary');
  assert.equal(tooBroadFolder('/Users/op/code/project', home, 'darwin'), null);
});

test("the App's workspace folders come from <framework>/.glass/shell.json; roots join them with the window's", () => {
  const fw = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-scope-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-proj-'));
  try {
    fs.mkdirSync(path.join(fw, '.glass'));
    fs.writeFileSync(path.join(fw, '.glass', 'shell.json'), JSON.stringify({ workspaceFolders: [proj, os.homedir(), '/does/not/exist', 7] }));
    // the temp folders are "temporary" to the App rule, so the test refuses only the home folder
    const homeOnly = (p: string) => (p === os.homedir() ? 'home' as const : null);
    assert.deepEqual(appWorkspaceFolders(fw, homeOnly), [proj], 'home is too broad; a missing folder and a non-string are dropped');
    assert.deepEqual(appWorkspaceFolders(path.join(fw, 'none')), []);
    const roots = scopeRoots(fw, [proj], [proj, os.homedir()], homeOnly);
    assert.deepEqual(roots, [fs.realpathSync(fw), fs.realpathSync(proj)], 'once each; the window\'s home folder is too broad');
  } finally {
    fs.rmSync(fw, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true });
  }
});

test("a session is in this window's tabs when its process descends from one of their shells", () => {
  // shell 100 → zsh 110 → claude 120 ; shell 200 ; claude 300 under launchd
  const table = parsePidTable(['100 1', '110 100', '120 110', '200 1', '300 1'].join('\n'));
  const all = [{ pid: 120, sessionId: 'in-tab' }, { pid: 300, sessionId: 'elsewhere' }, { pid: 200, sessionId: 'is-the-shell' }];
  assert.deepEqual([...sessionsUnder(all, new Set([100, 200]), table)].sort(), ['in-tab', 'is-the-shell']);
  assert.deepEqual([...sessionsUnder(all, new Set(), table)], [], 'no terminals, no tab membership');
  assert.deepEqual([...sessionsUnder(all, new Set([100]), new Map())], [], 'no process table, no tab membership');
});

test('the process table parses from ps rows and from Windows pid,ppid rows', () => {
  assert.deepEqual([...parsePidTable('  10  1\n 11 10\n')], [[10, 1], [11, 10]]);
  assert.deepEqual([...parsePidTable('10,1\r\n11,10\r\n')], [[10, 1], [11, 10]]);
});

test('activation registers the scope, so every list of the operator\'s sessions is scoped', () => {
  const ext = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /\binitOperatorScope\(\);/);
});
