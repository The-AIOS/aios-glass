/** Presence, the part only Glass can check: the rule itself is tested in @the-aios/core. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a dev host never announces presence (0.5.13 round: it overwrote the real glass.json)', () => {
  const fs = require('fs') as typeof import('fs');
  const ext = fs.readFileSync('src/extension.ts', 'utf8');
  const guard = ext.indexOf("if (devHost) log('spawn-inbox: presence not announced — dev host");
  assert.ok(guard > 0, 'the dev host skips the presence record');
  assert.ok(guard < ext.indexOf("const sdir = path.join(os.homedir(), '.aios', 'surfaces');"), 'before anything is written');
  assert.match(ext.slice(guard, guard + 200), /\n  else try \{/, 'and the whole presence block is the else branch');
});
