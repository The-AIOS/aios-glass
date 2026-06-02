# Changelog

All notable changes to **AIOS Glass** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] — 2026-06-01

### Fixed
- **Update badge no longer goes stale after a terminal-side sync.** The framework update indicator (the ↓ / ✓ in the panel header) previously only re-checked on initial load and on a hidden→visible toggle — so running `/aios:update` in a terminal while the panel stayed visible left the badge showing "behind" even though the vault was current. Added a `FileSystemWatcher` on `<vault>/.aios-update`, so the badge re-checks live the moment the tracker hash changes, regardless of where the sync ran.

## [0.1.4] — 2026-06-01

### Added
- **Contextual ritual nudge banner** — a single, warm, time-aware prompt at the top of the panel: plan your day (no today-note), the note's own 💡 suggested ritual (morning), wrap open sessions (daytime), close the day (evening). Per-kind dismiss (session-scoped) and a cog toggle (`aiosGlass.showNudges`, default on). The morning nudge renders the command in bold (`Run /7plan`) with the note's own one-liner clamped to two rows, and normalizes bare/legacy commands to `/aios:` on click.
- **Weekly-plan nudge** — on Mon/Tue, if this ISO week's `{YYYY}-W{WW}-plan.md` doesn't exist yet, the banner nudges `/7plan`. File-existence based, so it's reliable regardless of what the daily note suggests. _(helpers adapted from an external contribution, PR #7)_
- **Terminals hub** — the Sessions card became **Running** with **Sessions** and **Terminals** sub-lists. Manage plain terminals inline (focus / close), a ＋ per list header to spawn, and an optional **hide native terminal tabs** toggle.
- **`⌘⌥G` keyboard chord system** — a leader chord (`⌘⌥G` then a key) for 18 actions, with an on-panel collapsible 2-column cheat-sheet (column-major, persisted open/closed state independent of the hints toggle). Cards are arrow-navigable (focus, expand/collapse, toggle). `⌘⌥G H` shows/hides Glass (auto-detecting whether it's docked in the secondary or primary bar); `⌘⌥G M` minimizes/expands all cards.

### Changed
- **Foam is now a soft dependency, not a hard one** — Glass no longer refuses to activate on a stock editor that doesn't have Foam installed. The graph button guards on Foam's presence and offers a one-time install recommendation instead. _(first-run blocker on stock Antigravity)_

### Fixed
- **Symlinked vault paths** — `expandHome` now resolves symlinks, so the file watcher tracks the canonical path and live-refresh works when the vault is reached through a symlink.
- Spawned Claude sessions no longer appear in **both** the Sessions and Terminals lists (registration race — reconciled on the refresh poll).

## [0.1.3] — 2026-05-31

### Added
- **Show/hide secondary hints** — a cog toggle (`aiosGlass.showHints`, default on) flips the panel between the full hinted view and a clean, label-only view. Hides button hints + header subtitles; counts, the quota label, and helper lines stay.
- **Inline 7-day usage** in the Sessions quota label: `5h (7d 56%)` — the bar still carries 5h visually, with both metrics in the hover tooltip.
- **Live refresh for Workspaces** — adding/archiving a project or mounting a company now updates the Projects / Collaboration / Companies counts without a reload.

### Changed
- **Secondary-text pass across the whole panel** — consistent inline hints on every actionable (e.g. `browse · task`, `add your own`, `ventures context`, `you stated` / `claude learned`) and tightened card headers (`Daily`, `Sessions`, `Customize`, `Learned`, `Shipped`, with subtitles).
- Watcher-driven refreshes are **debounced** (250 ms) so bursts — autosave while editing a note, the multi-file export pipeline, a company sync — collapse into one re-scan.

### Fixed
- **Agent count** no longer over-counts: index READMEs mis-tagged as agents are excluded at the source, so the count reflects real agents (bundled + custom + company).
- Corrected/added tooltips (Projects, Launch-an-agent, Companies, Collaboration); removed a redundant Context explainer line.

## [0.1.2] — 2026-05-31

### Added
- **Live refresh** for the Home Workspace cards — `FileSystemWatcher`s now update the **Projects** count, **Collaboration** list, and **Companies** table the moment their sources change (project notes under `00 - notes/projects/`, and `USER.md`), with no panel hide/show or window reload. The Projects count stays a top-level tally, so archiving a project into a subfolder drops it out automatically — your taxonomy, not one baked into the extension.

## [0.1.1] — 2026-05-31

### Added
- Four context-driven frequent tasks: **elevator pitch**, **what's changed about me lately**, **podcast/interview intro**, and **values & non-negotiables** — each reads your declared/observed context at runtime.

### Changed
- **Go with agents** moved into the Daily Ritual card; its counter is now wired to the *unchecked* agent suggestions in your daily note (checked items no longer inflate it).
- The **Outputs** and **Reports** cards display reverse-alphabetically (Z→A) after selecting the most-recently-modified files.
- **Relicensed** from MIT to **GPL-2.0-or-later**, matching the AIOS framework.
- Install docs promote the Open VSX Registry as the primary, auto-updating install path; `.vsix` sideload documented as the fallback.

### Fixed
- Genericized hard-coded examples and comments so no environment-specific data ships in the extension.

## [0.1.0] — 2026-05-30

Initial public release on the [Open VSX Registry](https://open-vsx.org/extension/the-aios/aios-glass).

### Added
- **Home panel** — a single glass surface over the AIOS: Daily Ritual launcher (`/today`, `/close-session`, `/close-day`), Calendar (month grid reading `vault/01 - calendar/`, click-a-day to open/create the note), Quick actions, Sessions Running, Workspaces, and context cards (Personalizations, Context, recent Learnings, Outputs, Reports).
- **Rituals** discovered at runtime from `plugins/aios/commands/`, grouped by cadence and launched via Claude Code.
- **Agents** browser — discovers all agents from `agents/**` (bundles + company namespaces + custom); spawn with an optional task via the `spawn` wrapper. Plus **"go with agents"** off your daily note.
- **Capabilities** — Skills / MCPs / Plugins discovered at runtime; click to open the doc.
- **Spaces** — mounted companies and collaboration spaces, driven by argument-as-form pickers (no raw flags).
- **Title-bar actions** — vault graph, ＋ new custom (agent/skill/plugin), config cog, and cheatsheet.
- **Config cog** — model, permission mode, terminal mode, account swap, usage bar, remote-control toggle, framework-update status, and `/goal` · `/fewer-permission-prompts` · `/schedule` shortcuts.
- Live **Sessions Running** view from the AIOS session registry; named terminals with per-agent icon/color.
- **Onboarding walkthrough** (editor Welcome page) that completes as you use each surface.
- Foam declared as an `extensionDependency` (glass, not fork). Settings: `aiosGlass.frameworkPath`, `aiosGlass.claudeCommand`, `aiosGlass.terminalMode`, `aiosGlass.permissionMode`, `aiosGlass.operatorName`.

[Unreleased]: https://github.com/The-AIOS/aios-glass/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.3
[0.1.2]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.2
[0.1.1]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.1
[0.1.0]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.0
