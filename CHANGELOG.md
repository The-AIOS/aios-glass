# Changelog

All notable changes to **AIOS Glass** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/The-AIOS/aios-glass/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.2
[0.1.1]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.1
[0.1.0]: https://github.com/The-AIOS/aios-glass/releases/tag/v0.1.0
