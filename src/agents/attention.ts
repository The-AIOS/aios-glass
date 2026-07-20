import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * AI-7 — needs-input registry reader (SHARED, pure-Node — no `vscode`).
 *
 * The full loop: Claude Code's `Notification` hook fires when a session is
 * waiting on the human (a permission prompt, or ~60s idle awaiting input). A
 * tiny hook shim (`hooks/needs-input.mjs`, shipped in this repo) writes a marker
 * into `~/.claude/glass-attention/<sessionId>.json`; a matching
 * `UserPromptSubmit`/`Stop` hook clears it. This reader turns that registry into
 * the amber "needs your input" bucket surfaced by BOTH glasses — the Glass
 * extension's Sessions card AND the AIOS App's session viewer. It imports only
 * `fs`/`os`/`path`, so the App copies it verbatim (AI-53 topology).
 *
 * The registry is keyed by Claude's `sessionId` (uuid) — the stable id the
 * session registry (`~/.claude/sessions/<pid>.json`) also carries — so the two
 * join cleanly regardless of pid churn.
 */

/** A single "this session wants you" marker. */
export interface AttentionEntry {
  sessionId: string;
  /** The notification text Claude sent (e.g. "waiting for your input"). */
  message: string;
  /** epoch ms the marker was written. */
  ts: number;
}

/** The registry directory both the hook shim and this reader agree on. */
export const ATTENTION_DIR = path.join(os.homedir(), '.claude', 'glass-attention');

/**
 * Stale-marker TTL. A missed `clear` hook (crash, kill -9) must not strand a
 * session amber forever — a marker older than this is ignored (and swept). 30
 * min comfortably outlives any real "waiting on you" without going stale.
 */
export const ATTENTION_TTL_MS = 30 * 60 * 1000;

/**
 * Read the live needs-input registry → `sessionId → AttentionEntry`. Best-effort
 * and side-effect-light: skips unreadable/partial files and drops (best-effort
 * unlinks) markers past the TTL so the dir self-cleans. Resolves to an empty map
 * when the dir is absent (the normal state — nothing is waiting).
 */
export function readAttention(now: number = Date.now(), dir: string = ATTENTION_DIR): Map<string, AttentionEntry> {
  const out = new Map<string, AttentionEntry>();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out; // no registry dir → nothing waiting
  }
  for (const f of files) {
    const full = path.join(dir, f);
    let d: { sessionId?: string; message?: string; ts?: number };
    try {
      d = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue; // partially-written / unreadable → skip
    }
    const ts = Number(d?.ts) || 0;
    if (!ts || now - ts > ATTENTION_TTL_MS) {
      try { fs.unlinkSync(full); } catch { /* best-effort sweep */ }
      continue;
    }
    const sessionId = String(d?.sessionId ?? path.basename(f, '.json')).trim();
    if (!sessionId) continue;
    out.set(sessionId, { sessionId, message: String(d?.message ?? '').trim(), ts });
  }
  return out;
}
