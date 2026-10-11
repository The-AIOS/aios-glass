/**
 * AI-190 (Glass half) — which theme the Glass webviews paint. Pure: no `vscode` import, so the
 * unit tests can run it. `auto` (the default since 0.5.11) follows the editor's colour theme:
 * an exec on VS Code's stock Light Modern was greeted by a DARK Home panel inside a light IDE,
 * because the old default was `dark` and the co-switch only knew the AIOS themes.
 */
/** vscode.ColorThemeKind: Light = 1, Dark = 2, HighContrast = 3, HighContrastLight = 4. */
export function resolveGlassTheme(pref: string | undefined, editorKind: number): 'dark' | 'light' {
  if (pref === 'light' || pref === 'dark') return pref;
  return editorKind === 1 || editorKind === 4 ? 'light' : 'dark';
}
