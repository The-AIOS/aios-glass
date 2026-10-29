/**
 * AI-223 — VERIFY A SEND BY READING ONLY WHAT WAS APPENDED SINCE IT STARTED.
 * (Glass's twin of the App's src/main/transcriptSince.ts; vscode-free, so it is tested directly.)
 *
 * The measured failure (on the App): every repeat delivery went to one session whose transcript had
 * grown to 554 MB. The verifier read the WHOLE file into a string; past V8's ~512 MB string limit
 * that read throws, the catch turned the throw into "zero deliveries", and an idle target was typed
 * the same message three times. Glass read the transcript the same way. So:
 *  · the first read records the file's size, and every later read returns only the bytes after it
 *    (the deliveries counted are the ones since this send began, which is what the `sinceMs` filter
 *    in countDeliveries reduced the whole file to anyway);
 *  · a read that FAILS (anything but "no file yet") is null — "cannot verify" — and the caller must
 *    never re-type on it: the message was typed once, and a second copy is the bug.
 */
import * as fs from 'fs';

/** Appended text above this is not read: past it the string limit is in sight again. */
export const APPENDED_MAX_BYTES = 400 * 1024 * 1024;

export class TranscriptSince {
  private offsets = new Map<string, number>();
  /** Text appended to `file` since this send first looked; '' when there is no file (yet); null when unreadable. */
  read(file: string | undefined): string | null {
    if (!file) return '';
    try {
      const size = fs.statSync(file).size;
      if (!this.offsets.has(file)) this.offsets.set(file, size);
      const from = this.offsets.get(file) as number;
      if (size <= from) return '';
      if (size - from > APPENDED_MAX_BYTES) return null;   // absurd growth mid-send: cannot verify
      const buf = Buffer.alloc(size - from);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
      return buf.toString('utf8');
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null;
    }
  }
}
