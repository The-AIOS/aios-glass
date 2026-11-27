/**
 * What opening a day does. Glass never creates a daily note: `/aios:today` (and `/7plan`) write it.
 * A note Glass created held one heading line, and that was enough for the "Plan your day" nudge to
 * stop showing for a day nobody had planned. The App takes the same decision: open the note if it
 * exists, otherwise offer to plan the day.
 * Pure (no vscode, no fs) so the decision is testable.
 */
export type DayOpen = 'open' | 'offer-plan' | 'no-note';

export function dayOpenDecision(iso: string, exists: boolean, todayIso: string): DayOpen {
  if (exists) return 'open';
  return iso === todayIso ? 'offer-plan' : 'no-note';
}

/** Local calendar date as YYYY-MM-DD (the daily note's name is the operator's day, not UTC's). */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
