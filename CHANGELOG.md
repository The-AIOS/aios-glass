# Changelog

All notable changes to AIOS Glass are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com).

## [0.0.1] — Unreleased

### Changed — Refinement pass 4 (layout + feedback)
- **4-column layout**: ① Daily ritual loop · Calendar · Personalizations  ② Quick · Spaces  ③ Agents running  ④ Create.
- **Context → Personalizations** (Intent + USER only). **Cheatsheet** moved to a **help (?) icon** beside the cog.
- **Quick** is action-driven: Browse agents → spawns on select · Browse skills → **invokes the skill** in the terminal · Run a command · **Spawn a worker** (adjective-animal ad-hoc name) · Resume.
- **Create**: dropped "New command" (a command is a plugin); kinds are agent / skill / plugin / template / hook / MCP.

### Changed — Refinement pass 3 (feedback)
- **Resume** now uses `claude --resume` (session picker), not `--continue`.
- **Status** moved out of a card → a header badge beside the cog: **✓ up to date** / **updates available** (click → `/aios:update`).
- **Create** card → one dotted button per element (New agent / skill / plugin / command / template / hook / MCP); all open the same AIOS builder with the right instruction.
- **Quick** card now holds Browse agents (search picker) · Browse skills · Run a command · Resume. **Skills card removed**; **Agents card** shows only running workers.
- **Remote control** defaults **on** (was off, so it read "off"); toggle persists and appends `--remote-control` to launches.

### Changed — Refinement pass 2 (feedback)
- **Calendar**: caption trimmed to "Click to read · ⌘/Ctrl-click to edit"; **only days with a note are clickable** — no more accidental note creation on empty days.
- **Daily ritual loop** card (hero): the three carrying commands (today → close-session → close-day) with the "this is how it compounds" framing.
- **Quick** card: spawn agent · resume last session (`claude --continue`) · run a command.
- **Agents → orchestrator**: live running-worker count + names (scans `ps` for `claude --name`), "Running" → manage → **spawn-kill**; "Browse all agents" focuses the sidebar.
- **Create** card: one "Add a custom element" → picker of **agent / skill / plugin / command / template / hook / MCP**, each launching an interactive **AIOS builder** prompt (interview → pull skill-creator/templates/best-practices → scaffold under `custom/`).
- **Cog**: real gear icon (was a sun glyph) + new **Remote control** toggle (appends `--remote-control` to launches).
- Layout: calendar spans two rows + dense packing (no gap under the first card).

### Changed — Refinement pass (feedback)
- **Header**: logo + "AIOS Glass" wordmark (was "Home"); greeting moved beside a **cog button** (top-right) that opens the Config menu — model / permission mode / terminal mode / login / logout / auth status. Config card removed from the grid.
- **Agents**: discovery now requires `tags: [agent]`, excluding reference/eval docs that lived under agent folders (85 → 40 real agents).
- **Capabilities → Skills + Commands**: Home now has a **Skills** card (browse → open) and a **Commands** card (run any `/aios:*` via a picker), instead of a generic MCP/plugin "Capabilities" card. (Full Skills/MCPs/Plugins tree still available in the sidebar.)
- **Calendar**: no longer double-width — fits as a normal card; tighter rows.
- **Status**: shows live **up-to-date / update-available** via `git ls-remote` against canonical HEAD.
- **Spaces**: companies + collaboration shown symmetrically (collaborate works just like companies — pickers, no flags).
- **Create new**: "＋ New custom agent / skill / plugin" (Home cards + Agents/Capabilities view titles) launches native Claude to scaffold it under `custom/`.

### Added — Phase 6: Onboarding walkthrough
- **Get started with AIOS Glass** walkthrough (Antigravity Welcome page): 8 steps — welcome → set framework path → open Home → plan day → spawn agent → capabilities → companies/spaces → cold-start. Steps complete on the matching command. Opens automatically on first run; re-open via `AIOS: Open Getting Started`.

### Added — Phase 5: Spaces & Status
- **Spaces** sidebar view: mounted companies (parsed from USER.md → Companies (mounted)) + collaboration spaces (`space-*` notes). Click a company → company-action picker; click a space → open its note.
- Home **Spaces card** (args-as-forms): Companies picker (mount / sync / sync-all / status / invite / create — URLs and company names via input/pick) and Collaborate picker (add-project / status / new space / dry-run). No raw flags typed.
- Home **Status card**: framework version from `.aios-update` (hash + synced date) + one-click `/aios:update`.

### Added — Phase 4: Capabilities
- **Capabilities** sidebar view: Skills / MCPs / Plugins, each discovered at runtime (`skills/**/SKILL.md`, bundled `mcps/*`, `plugins/**/.claude-plugin/plugin.json`). Click a skill/MCP/plugin to open its doc (Markdown → preview, JSON → editor).
- Home **Capabilities card**: shows `skills · MCPs · plugins` counts + opens the panel.
- (MCP live-health deferred — servers aren't registered in `~/.claude.json` top-level.)

### Added — Phase 3: Agents
- **Agents** sidebar view: discovers all agents at runtime from `agents/**` (bundles + company namespaces + custom), grouped + searchable. Zero hardcoded list.
- **Spawn flow**: pick an agent (or click one in the tree) → enter an optional task → launches `spawn <name> "<task>"` via the zsh wrapper in the configured terminal.
- Home **Agents card** wired: shows agent count + "Spawn an agent" button.
- Frontmatter parser now also reads `name`.

### Added — Config card & polish
- **Config card** on Home: shows signed-in account (`~/.claude.json`), default model (`~/.claude/settings.json`), and permission mode. Login / Logout / Status run `claude auth …`; Model picker writes the global default model; Mode picker sets the launch permission mode.
- **`aiosGlass.terminalMode`** — `dedicated` (default) · `active` · `new` · `ask` (pick a terminal each time).
- **`aiosGlass.permissionMode`** — when set, Glass appends `--permission-mode` to native-Claude launches.
- Brand polish: real The-AIOS logo mark (activity-bar icon, marketplace icon, Home header); tightened calendar density.

### Added — Phase 2: AIOS Home dashboard
- **AIOS Home** webview panel (`aios.openHome`, home button in the Rituals title bar) — a branded, app-like dashboard that opens in the editor area. The product's front door.
- **Calendar card** (live): Monday-first month grid reading `vault/01 - calendar/{YYYY-MM}/`, dots on days with daily notes, today highlighted, month nav, click-a-day → open or create the daily note. Excludes weekly `-plan`/`-summary` files.
- **Today card** (live): Plan day / Close day / Close session → native Claude.
- **Agents** + **Spaces** cards as roadmap placeholders (Phase 3 / Phase 5).
- Operator greeting pulled from `about_me.md` (override: `aiosGlass.operatorName`).

### Added — Phase 0 + 1: foundation & Rituals
- Project foundation: standalone VS Code / Antigravity extension (TypeScript), Foam declared as an `extensionDependency` (glass, not fork).
- **AIOS** activity-bar container.
- **Rituals** view (Phase 1 walking skeleton): discovers `/aios:*` commands at runtime from `plugins/aios/commands/`, groups by cadence (Daily / Weekly / Bi-weekly / Monthly / As needed), and launches each via native Claude Code in an integrated terminal. Commands declaring an `argument-hint` prompt for arguments first.
- `aiosGlass.frameworkPath` and `aiosGlass.claudeCommand` settings.
