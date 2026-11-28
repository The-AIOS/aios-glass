import * as fs from 'fs';
import * as path from 'path';
import { SessionNote, harvestAppendix } from './sessionNotesParse';

/**
 * Put a killed session's post-its at the end of the daily note at `daily`, creating it when it
 * does not exist. Kept free of vscode so the file behaviour is tested on a real folder.
 *
 * Only a missing note reads as empty. Any other read failure throws before anything is written:
 * reading it as '' is how the whole note used to be replaced by the post-its alone. The write is
 * an append, never a rewrite, so another writer's block that lands meanwhile is kept.
 */
export function appendHarvestToNote(daily: string, name: string, stamp: string, notes: SessionNote[]): void {
  let md = '';
  try { md = fs.readFileSync(daily, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  fs.mkdirSync(path.dirname(daily), { recursive: true });
  fs.appendFileSync(daily, harvestAppendix(md, name, stamp, notes));
}
