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
- `src/extension.ts` — activation + command registration.

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
