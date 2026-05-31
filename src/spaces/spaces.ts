import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { frameworkRoot, vaultRoot } from '../home/vault';

/** A company mounted into the vault (a row of USER.md → Companies (mounted)). */
export interface Company {
  name: string;
  substrate: string;
  source: string;
  lastSync: string;
}

/** A collaboration space (a `space-*` project note). */
export interface CollabSpace {
  name: string;
  filePath: string;
}

/** Framework update tracker (`.aios-update`). */
export interface FrameworkStatus {
  repo: string;
  hash: string;
  synced: string;
}

function stripCell(s: string): string {
  return s.trim().replace(/^`|`$/g, '').trim();
}

/** Parse the `## Companies (mounted)` markdown table in USER.md. */
export function readCompanies(): Company[] {
  const root = frameworkRoot();
  if (!root) return [];
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, 'USER.md'), 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Companies \(mounted\)/.test(l));
  if (start < 0) return [];

  const out: Company[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next section
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(stripCell);
    if (cells.length < 5) continue;
    const [company, substrate, source, , lastSync] = cells;
    if (!company || company.toLowerCase() === 'company' || /^-+$/.test(company)) continue;
    out.push({ name: company, substrate, source, lastSync });
  }
  return out;
}

/** Collaboration spaces: `space-*.md` project notes. */
export function readCollabSpaces(): CollabSpace[] {
  const v = vaultRoot();
  if (!v) return [];
  const dir = path.join(v, '00 - notes', 'projects');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith('space-') && f.endsWith('.md'))
    .map((f) => ({ name: f.replace(/^space-/, '').replace(/\.md$/, ''), filePath: path.join(dir, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse `.aios-update` (key=value lines). */
export function readFrameworkStatus(): FrameworkStatus | undefined {
  const root = frameworkRoot();
  if (!root) return undefined;
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, '.aios-update'), 'utf8');
  } catch {
    return undefined;
  }
  const kv: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-z]+)=(.*)$/i);
    if (m) kv[m[1]] = m[2].trim();
  }
  return { repo: kv.repo ?? '', hash: kv.hash ?? '', synced: kv.synced ?? '' };
}

export type UpdateState = 'up-to-date' | 'available' | 'unknown';

/**
 * Compare the last-synced hash (`.aios-update`) against canonical HEAD via
 * `git ls-remote`. Network/SSH; resolves 'unknown' on any failure or offline.
 */
export function checkForUpdates(): Promise<UpdateState> {
  const status = readFrameworkStatus();
  if (!status || !status.repo || !status.hash) return Promise.resolve('unknown');
  return new Promise((resolve) => {
    execFile('git', ['ls-remote', status.repo, 'HEAD'], { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve('unknown');
      const remote = stdout.trim().split(/\s+/)[0];
      if (!remote) return resolve('unknown');
      resolve(remote.startsWith(status.hash) ? 'up-to-date' : 'available');
    });
  });
}
