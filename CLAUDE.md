# CLAUDE.md — aios-glass

A VS Code / Antigravity extension that is a **glass layer over the AIOS**. It surfaces and triggers the framework's existing capabilities (slash commands, `spawn` agents, company/collaborate syncs); it does **not** reimplement them.

## The one principle: glass, not engine

Every feature must *read the framework's own source of truth at runtime* and *trigger the existing mechanism* — never duplicate AIOS logic into the extension. Examples:

- Rituals read `plugins/aios/commands/*.md` live (no hardcoded command list) and launch `claude "/aios:<name>"` in a terminal.
- Future Agents view will read `agents/_index.md` and call the `spawn` wrapper.
- Future Spaces view will read `USER.md`'s companies table and run `/aios:company` / `/aios:collaborate`.

If you find yourself encoding *what a command does*, stop — the extension should only know *that the command exists* and *how to launch it*.

## Architecture

- **Depends on Foam** (`extensionDependencies: ["foam.foam-vscode"]`) for vault navigation — wikilinks, backlinks, graph. We do not fork Foam; it stays the engine and auto-updates from upstream.
- TypeScript, compiled with `tsc` to `out/`. No runtime dependencies (only dev: typescript, @types).
- `src/aios/` — framework-facing discovery/parsing (the glass↔engine boundary).
- `src/rituals/` — the Rituals surface (provider + runner).
- `src/files/` — AIOS Files, a collapsible file **tree** (a `WebviewViewProvider` in its OWN activity-bar container `aios-files`, so the Home container stays a single view titled just "AIOS Glass"). Three sections — FRAMEWORK (skips `vault/` + noise) / VAULT / WORKSPACE (operator-added, `.glass/state.json`). The webview can't call `fs` directly, so `files.js` does directory reads over a `postMessage` round-trip exposed as an awaitable `fsList(dir)` (reqId-correlated) — lets the tree recurse like sync fs. Opens files via `aios.openOutput`; right-click → `aios`-side `revealFileInOS`. Path access sandboxed to the section roots. Owns no AIOS logic. (Two `type:webview` views in one container is what broke the earlier stacked arrangement — keep them in separate containers.)
- `src/extension.ts` — activation + command registration.
- `src/i18n.ts` — localization (en default · es neutral-LATAM · pt-br). The cog-menu **Language** switcher (`aiosGlass.language`: auto/en/es/pt-br) is the in-app source of truth — `effectiveLocale()` reads it, falling back to `vscode.env.language`. Three layers:
  - **Host popups** (QuickPicks, InputBoxes, notifications) use our own `t('English source')` (in `i18n.ts`), which reads `l10n/bundle.l10n.<locale>.json` keyed by the effective locale — so the switcher governs them **instantly, no IDE reload**. `initI18n(context.extensionUri)` must run once at activation. (`vscode.l10n.t` is NOT used for new strings — it follows only the IDE display language and ignores the setting.) Keys are the English string; a miss degrades to English. Beware: don't call `t()` inside a callback that shadows it with a param named `t` (e.g. `.map((t) => …)`).
  - **Static `package.json` titles** use `%key%` resolved from `package.nls*.json` — these follow the IDE display language only (VS Code owns them; needs Configure Display Language + reload).
  - **Webview** strings (`vscode.l10n` can't reach a webview) load from `media/i18n/strings.<locale>.json` (via `effectiveLocale()`) in the host and inject as `window.__nls` via the `{{NLS}}` placeholder; `home.js` applies it to `[data-i18n]`/`[data-i18n-title]`/`[data-i18n-aria]` nodes + `NLS(key)` for dynamic strings. English text stays baked into `home.html` as the literal fallback — a missing catalog/key degrades to English, never blank. Changing the language calls `HomeViewProvider.rerender()` (re-sets `webview.html` so `window.__nls` is rebuilt — a plain `refresh()` only posts data and won't relocalize).
  - Adding a string: webview → add the key to all three `strings.*.json` + reference via `data-i18n` (static) or `NLS('key','English fallback')` (dynamic); host popup → wrap in `t('…')` + add the English key to `bundle.l10n.es.json` + `bundle.l10n.pt-br.json`. The smoke test substitutes `{{NLS}}` → empty (English path). All host popups (palette, config menu, frequent tasks/routines, reports, spaces, skills/agents/commands pickers, spawn, ingest, terminal/session pickers) route through `t()` — 290 keys, full es + pt-br coverage. **Still English (known follow-up):** the Files-explorer webview itself (no `__nls` injection yet) + the framework-data labels Glass surfaces verbatim (agent/command/skill names, seed frequent-task labels).

Glass surfaces share one theme (`aiosGlass.theme`, dark default). Every webview's colours are CSS tokens with a `body.light` override, so a single setting reskins Home + Files together; the `<body>` class is stamped at render time to avoid a flash. Add a panel name to `PANELS` in `scripts/smoke.mjs` and its boot is gated too.

## Build / run

```bash
npm install
npm run compile      # or npm run watch
```

Press **F5** → "Run AIOS Glass (Extension Dev Host)" — opens a host window with `~/obsidian` loaded.

Logic-layer smoke test (runs compiled discovery in plain Node by stubbing `vscode`): see the pattern in the session notes; useful because most of `src/aios/` is pure and testable without the editor host.

## Settings

- `aiosGlass.frameworkPath` (default `~/aios`) — root containing `plugins/aios/commands/`.
- `aiosGlass.claudeCommand` (default `claude`) — how to launch native Claude Code.

## Roadmap (phased)

1. ✅ Rituals launcher — **shipped**
2. Calendar (vault-aware daily notes, `{YYYY-MM}/` layout)
3. Agents browser (native-Claude spawn)
4. Capabilities (skills / MCPs / plugins)
5. Spaces (`/company` + `/collaborate`, args as forms) + AIOS Status (update/sync)
6. Onboarding walkthrough (non-dev front door)
