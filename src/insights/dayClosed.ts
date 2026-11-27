/**
 * Whether a daily note is closed: it carries the `## Close of Day` heading /aios:close-day writes.
 * The same line /aios:today's precondition greps for (`^## Close of Day`), so the nudge and the
 * morning guard cannot disagree about one note. Only the heading counts: a task or a tip that
 * mentions closing the day is not it. Same rule as the AIOS App. No editor API here, so it is tested.
 */
export function isDayClosed(md: string): boolean {
  return /(?:^|\n)## Close of Day/.test(md);   // a line starts after \n only, as it does for grep
}
