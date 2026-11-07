import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { identityRowsIn, choosePrimaryIdentity } from '../core/primaryIdentity';

const USER_MD = ['## Identity', '', '| Name | Role | Greeting style |', '|---|---|---|', '| `laptop-main` | Laptop primary | Warm. |', '| `agent-box` | Agent machine | Brief. |', '', '## Settings'].join('\n');

test('parity with the AIOS App: this computer\'s primary identity, machine-local, first row by default', () => {
  const rows = identityRowsIn(USER_MD);
  assert.deepEqual(rows.map((r) => r.name), ['laptop-main', 'agent-box']);
  assert.equal(choosePrimaryIdentity(rows, '').name, 'laptop-main');
  assert.equal(choosePrimaryIdentity(rows, 'agent-box').name, 'agent-box');
  assert.deepEqual(choosePrimaryIdentity(rows, 'gone'), { name: 'laptop-main', stale: true });
  assert.notEqual(rows[0].name, choosePrimaryIdentity(rows, 'agent-box').name, 'control: first-row-always launches the wrong identity');
  const vault = fs.readFileSync('src/home/vault.ts', 'utf8');
  assert.match(vault, /path\.join\(os\.homedir\(\), '\.aios', 'app\.json'\)/, 'the App\'s machine-local file, never the synced framework');
  assert.match(vault, /choosePrimaryIdentity\(identityRowsIn\(text\), storedPrimaryIdentity\(\)\)\.name \|\| 'aios'/);
});
