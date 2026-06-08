# Changelog

All notable changes to **AIOS Glass** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.7] — 2026-06-08

### Fixed
- **Contextual nudge no longer sticks on a future-dated note.** `/aios:7plan` pre-creates skeleton notes for the days ahead, and `latestDailyNote()` returned the highest-*dated* file — so a future skeleton (e.g. `2026-06-12` while today is `2026-06-08`) masqueraded as "latest", `isToday` went false, and "Plan your day" fired forever even after a window reload. Both resolvers (`insights` + `goWithAgents`) now cap at today, so "latest" means the *most recent actual daily note*. The week-calendar view still shows future skeletons; close-day detection reads the right note again. (#9)
- **"Go with agents" sees command-routed tasks again.** The daily note's *Agents can handle* section routes each task either to a named `[[agent]]` or to a backticked `/command` (ingests use `` `/aios:ingest` ``). The reader only understood the `[[agent]]` shape, so command-routed tasks — the most common kind — were invisible: the Home badge read **0** and "Go with agents" found nothing. It now recognizes both shapes (lifting a source URL from the line when present) and dispatches accordingly: agent tasks via `spawn`, command tasks into their own fresh `claude "/aios:ingest <url>"` session — one terminal per task.

## [0.1.6] — 2026-06-05

### Added
- **✨ Ask AIOS** — the magic entry. Type what you need and Claude matches your ask to the right context & tools in your AIOS — and puts them to work. A full-width gradient-hairline button under Launch/Resume, the `⌘⌥G Q` chord, **and a fallback in every action picker**: whatever you type that matches nothing becomes an `Ask AIOS: "…"` item, so an unmatched search resolves by *meaning* instead of dead-ending. Each ask runs in a fresh session named from your intent's content words (`ask-social-media-strategy`).
- **Routines** — named, **ordered bundles of frequent tasks that run in one click** (e.g. *"Monday Kickoff → [plan the day, prep the meetings, draft the posts]"*). Live in the Quick menu above Tasks; *Add a routine* walks name → tasks picked one-at-a-time in run order. Running one assembles the tasks' fixed assignments into **one ordered instruction fired into a single fresh session**, with a per-step summary at the end. (No cadence/triggers — a routine is bundled clicks, not a scheduler; real scheduling is future `/schedule` work.)
- **`⌘⌥G *` — the wildcard palette.** One fuzzy picker over *everything* launchable: live sessions, routines, tasks, agents, commands, skills — grouped, matched on descriptions, Enter routes to the right launcher (commands keep their argument prompts). The per-kind chords stay for muscle memory.
- **Agent search keywords.** Agents can declare `keywords:` frontmatter (search synonyms — content-writer carries *"social media, posts, linkedin…"*); pickers fold them into the matched text so intent words find the right agent lexically, with Ask AIOS covering the semantic long tail. The bundled + company agents shipped with keywords on their side.
- **Card reordering** — ↑↓ buttons on a card's title (hover) and `Alt+↑/↓` on a focused title move it through the 1-column order; Daily stays pinned on top. Persisted; never-reordered panels keep the curated default.
- **Per-session actions** on the Sessions list (hover): **interrupt** (send Esc — only while working), **close session** (runs `/aios:close-session` in that exact terminal, capturing the session before you kill it — door/exit icon), and **kill** (always red, destructive affordance).
- **Type-to-create** in the Quick menu: an unmatched search offers `Create task "<your text>"` — dead-end searches become creation.
- **Frequent tasks are one-click.** The per-run question is gone — an optional **fixed assignment** is *sent* on every run (blank = launch bare; the agent interviews you, the command/skill guides). Legacy tasks migrate automatically: the text typed into the old "question" field becomes the assignment it fires. The variable "about me" defaults now self-elicit their specifics after launch.

### Changed
- **Live session rows** — `name · working 2m · project`, always one line; **not-ready dots breathe** (working pulses a soft amber glow; needs-input pulses faster — ready sits still; `prefers-reduced-motion` respected). The footnote and zero-counters now obey the Secondary-hints toggle.
- **The panel looks like its name** — glass cues across the board: a top edge that catches light on every card, soft depth shadows, a static specular on the Ask button, and one shared hover language (each surface brightens in its own palette; the Daily hero glows accent). Nudges went **grey** — they whisper; coral now belongs exclusively to actions.
- **Resume adopts the picked session's name** — after you choose a session inside Claude's TUI, the `resume` terminal renames itself to match (best-effort, while the terminal is active).
- **"Go with agents" count is live** — it now recognizes the ledger's `~~struck-title~~ ✅` done-convention, and spawning a suggestion stamps the line `🚀` (in flight) so the badge drops the moment an agent has the ball.
- Cheat-sheet: 20 entries — `Q ask aios` leads column 1, `*` palette closes column 2, and a full-width `⌥ ↑ ↓ move selected card` footer row. Calendar header is always `MMM YYYY` (both views), the month/week view choice is remembered across reloads, and compact mode now actually compacts the grid.

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
