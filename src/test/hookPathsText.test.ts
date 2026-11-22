/** aios#330: canonical v0.8.21 removes the forwarding files at the old flat hook paths. Text Glass writes for agents to
 *  act on (the spawn-inbox README, the Health card's help prompt) must name each moved hook in its folder. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
/* The hooks canonical v0.8.19 moved into folders that Glass names (same list as the App's HOOK_FOLDER). */
const MOVED = ['resolve-tier', 'install-settings.py', 'issue-scrub.py', 'aios-health.py', 'inject-datetime.sh', 'provenance.py', 'bus_log.py', 'floor-at-start.py', 'model-switch-log.py', 'suggest-agent-hint.py'];
/* Code only: comments may say where a hook used to live. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const flat = (text: string): string[] => MOVED.filter((f) => new RegExp(`hooks/${f.replace(/[.]/g, '\\.')}(?![\\w.-])`).test(text));

test('the inbox README and the Health help prompt name every moved hook in its folder', () => {
  for (const f of ['src/extension.ts', 'src/home/health.ts']) assert.deepEqual(flat(code(fs.readFileSync(path.join(ROOT, f), 'utf8'))), [], f);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/extension.ts'), 'utf8'), /hooks\/pipeline\/resolve-tier --list/);
});

test('negative control: the old flat path is caught', () => {
  assert.deepEqual(flat("'run ~/aios/hooks/resolve-tier --list'"), ['resolve-tier']);
  assert.deepEqual(flat("'run ~/aios/hooks/pipeline/resolve-tier --list'"), []);
});
