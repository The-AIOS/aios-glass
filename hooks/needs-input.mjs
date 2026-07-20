#!/usr/bin/env node
/**
 * AI-7 — needs-input hook shim (ships WITH the Glass extension repo).
 *
 * Claude Code's `Notification` hook fires when a session is waiting on the human
 * (a permission prompt, or ~60s idle awaiting input). Wired as the `set` mode,
 * this writes a marker into `~/.claude/glass-attention/<sessionId>.json`; wired
 * as `clear` on `UserPromptSubmit` / `Stop`, it removes the marker. Both glasses
 * (the Glass extension's Sessions card + the AIOS App's session viewer) read
 * that registry via `src/agents/attention.ts` and light the amber bucket.
 *
 * The hook receives the event JSON on STDIN. It is deliberately dependency-free
 * and never fails the tool call: any error exits 0 (a broken attention marker
 * must never break the session it's about).
 *
 * Register (in ~/.claude/settings.json — install-time, outside this repo):
 *   "hooks": {
 *     "Notification":      [{ "hooks": [{ "type": "command",
 *        "command": "node <ext>/hooks/needs-input.mjs set" }] }],
 *     "UserPromptSubmit":  [{ "hooks": [{ "type": "command",
 *        "command": "node <ext>/hooks/needs-input.mjs clear" }] }],
 *     "Stop":              [{ "hooks": [{ "type": "command",
 *        "command": "node <ext>/hooks/needs-input.mjs clear" }] }]
 *   }
 */
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.claude', 'glass-attention');
const mode = (process.argv[2] || 'set').toLowerCase();

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(buf); } };
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf += c; });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
    } catch { done(); }
    setTimeout(done, 1500); // never hang a hook waiting on stdin
  });
}

const raw = await readStdin();
let payload = {};
try { payload = JSON.parse(raw || '{}'); } catch { /* non-JSON → empty */ }

// Claude Code uses snake_case (session_id); accept camelCase too, defensively.
const sessionId = String(payload.session_id ?? payload.sessionId ?? '').trim();
if (!sessionId) process.exit(0); // nothing to key on

const file = join(DIR, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

try {
  if (mode === 'clear') {
    try { unlinkSync(file); } catch { /* already gone */ }
  } else {
    mkdirSync(DIR, { recursive: true });
    const message = String(payload.message ?? 'waiting for your input').slice(0, 240);
    writeFileSync(file, JSON.stringify({ sessionId, message, ts: Date.now() }) + '\n');
  }
} catch { /* attention markers are best-effort — never break the session */ }

process.exit(0);
