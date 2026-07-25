# Changelog

All notable changes to **AIOS Glass** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.6] — 2026-07-25

> **`send` no longer drops messages into busy sessions — and never claims a delivery it hasn't observed.** Found the hard way an hour after shipping 0.4.5: a `send` to a session that was mid-turn vanished *completely* — the text never reached the input and was never queued — while everything upstream looked successful, because the request file had been consumed. Consuming the file only ever proved Glass picked it up. Delivery is now status-aware and **verified**.

### Fixed
- **A `send` to a BUSY target is held until it goes idle, then delivered.** Typing into a mid-turn session drops the text on the floor (not queued — gone). Glass now reads the target's `status` from the session registry first and holds the message until the session is idle (polling, up to 5 min) before delivering. A target that ends while its message is held is reported as dropped, not silently forgotten.
- **Delivery is verified against the target's own transcript.** After sending, Glass polls `~/.claude/projects/*/<sessionId>.jsonl` (up to 20s) for the text becoming an actual turn, and logs `delivered + VERIFIED ✓` or `NOT VERIFIED` — the latter also raises a notification telling you to re-drop the request. The verification needle is chosen to survive JSON escaping (the longest run of characters that aren't escaped inside a `.jsonl`), so a match isn't lost to quoting.
- **A `send` to a name with no live session is now loud** — logged as DROPPED plus a warning, instead of a quiet no-op.

### Changed
- The inbox README documents the behaviour: `send` to a busy session isn't instant *by necessity*, what the output channel says, and — for anyone implementing another fulfiller — that **an unverified `sendText` is a silent drop**.

### Notes
- `INBOX_CONTRACT` stays **1**: the verbs and fields did not change, only delivery mechanics. (Lockstep with the AIOS App holds — a verb/field change bumps both sides in one push.)
- Same delivery: Open VSX auto-update, then restart the IDE.

## [0.4.5] — 2026-07-25

> **Glass is no longer the only fulfiller — the doc now says so.** The AIOS App ships its own spawn-inbox handler with the identical three verbs, and it politely *defers* this README to Glass when both are installed (so there's no write war). The consequence: on a co-installed machine the doc an agent reads was Glass's, and Glass's copy claimed Glass was the mechanism — an agent could conclude the bus needs the IDE. Nothing broke (the verbs match), but it's the same class of partial-truth the 0.4.4 self-doc existed to kill, so it gets fixed the same way.

### Changed
- **The README is now fulfiller-neutral.** The contract sections never name a surface — *"a trusted AIOS surface fulfils it natively"*, with the mechanism stated only where the two genuinely differ (Glass: `vscode.createTerminal`/`sendText` in the IDE · the App: a real session pane), plus an explicit *"the verbs are identical either way — never learn a surface-specific dialect."* The one honestly Glass-specific gotcha (same-window reach for `send`/`kill`) is now labelled as such, and notes that co-installed, whichever surface picks the file up is the one that acts — the App defers the *doc*, not the *requests*.
- **Machine-readable contract trailer**, symmetric with the App's: `<!-- aios-spawn-inbox: contract 1 · written by AIOS Glass vX.Y.Z -->`. This is the load-bearing bit rather than copy — today the App can only detect *"Glass wrote this"* and defers unconditionally; a contract number lets a future verb/field change be recognised as **stale** instead of silently kept. Bump on both sides together when the verbs change.
- Deliberately preserved: the literal phrase **"written by AIOS Glass"** in the body. The App's `shouldWrite()` matches `/written by aios glass/i` to decide deference — neutralising that phrase away would make the App stop recognising Glass's doc and start clobbering it on every launch. Interop constraint, not styling.

### Notes
- Same delivery as always: Open VSX auto-update, then **restart the IDE** — the refreshed README is written on activation.
- The App covers the case Glass structurally cannot: an operator with no IDE and no extension still finds the contract in the directory, because the App writes it when the file is absent.

## [0.4.4] — 2026-07-25

> **The inbox documents itself.** Sessions could *use* the command bus but had to rediscover it every time — one session spent six tool calls grepping `extension.ts` to derive the `send` schema before it could say hello to another session, and another declared a live peer dead because it looked for it with `pgrep` (which lies for a resumed session). The directory now ships its own README, written by Glass on activation: the component that implements the dispatch is the only thing that documents it, so the doc can never drift from the handler.

### Added
- **`~/.aios/spawn-inbox/README.md`, written (and refreshed) by Glass on every activation.** Beside the `mkdirSync` that already creates the inbox. It documents, at the point of need: the **three verbs** with exact JSON (`spawn` · `send` · `kill`, plus optional `model`/`tier`); **addressing** — the session registry (`~/.claude/sessions/*.json` → `name` · `pid` · `status` · `sessionId`) is the *only* truth for a session's name, never `pgrep`, never a terminal tab title, because a **resumed** session keeps whatever its tab was called and silently looks dead; **replying** to whoever requested you (`send` back to the coordinator's registry name — the pid-ancestry resolution from 0.4.3 is what makes this work for long-lived coordinators); and the gotchas that each cost a real bug (one-line prompts · the file vanishing means *picked up*, not *succeeded* — verify via the target's transcript · same-window reach · malformed requests ignored). Rewritten only when the content actually changes, so the mtime stays stable. It is not a `*.json` file, so the watcher ignores it.
- **Smoke guard: inbox self-doc** — `scripts/smoke.mjs` fails the run if `extension.ts` stops writing that README, keeping Glass the single writer (schema owner == doc owner). Joins the settings-parity and delivery-robustness guards.

### Notes
- **How you get it:** the README arrives with the extension — Open VSX auto-updates AIOS Glass, then **restart the IDE** and the file appears (or refreshes) on activation. Nothing in the framework tree can ship it: `~/.aios/spawn-inbox/` is machine-local runtime state, not a repo path, which is exactly why Glass owns it. The matching always-loaded contract (CLAUDE.md → *Spawning Sessions*) and the deeper `orchestration-ladder` skill arrive separately, via `/aios:update`.
- No Glass installed → no watcher, no bus, and no README needed; the framework contract's "hand the spawn to the operator" path covers that case.

## [0.4.3] — 2026-07-23

> **Command-bus hardening — the round-trip now closes to a resumed coordinator, and a realistic multi-line task can't crash the host.** A full end-to-end test of the 0.4.2 bus (spawn → send → receive-back → kill) surfaced two defects: messaging a session *back* silently dropped when its terminal was resumed rather than Glass-created, and a multi-line spawn task crashed the integrated terminal. Both are fixed and locked with a smoke-test invariant. `spawn`, `send`, and `kill` were each verified live; this release closes the fourth leg — a worker replying to a long-lived coordinator (`buddai`/`fleet-heron` are always resumed) — which is the whole point of inter-agent orchestration.

### Fixed
- **`send`/`kill` now reach RESUMED sessions, not just Glass-created ones.** `findAgentTerminal` resolves the target's pid from the session registry (`listRunningAgents` — authoritative even for a resumed / bare `claude --resume` / externally-started session) whenever the caller passes none, and matches the terminal by **process ancestry**. Previously these verbs fell through to a terminal **tab-name** match, which only matches terminals Glass itself created (name === session name); a resumed session's tab keeps a different API name (a UI rename never propagates to `Terminal.name`), so an inbox `send`/`kill` aimed at it was consumed and then **silently dropped**. This centralizes the robust match for every delivery verb (`send`, `kill`, `interrupt`, `reveal`).
- **A multi-line or large spawn task no longer crashes the terminal.** `launchSpawn` TYPES the `spawn …` command into a terminal (`sendText`); a task with embedded newlines was typed as a burst of Enter-presses and a large body flooded the integrated terminal — enough to crash the host (observed on Antigravity). Multi-line / long tasks (`>240` chars) are now written to a temp file (`os.tmpdir()/aios-spawn-task-<name>.md`) and the worker is told to read it — mirroring the shell wrapper's own long-task indirection; only short single-line tasks are inlined into the typed command.

### Added
- **Smoke-test delivery-robustness guard** — `scripts/smoke.mjs` now statically asserts both invariants against `runner.ts` (pid-from-registry resolution in `findAgentTerminal`; temp-file handoff in `launchSpawn`), so a future refactor can't silently regress either fix. Runs alongside the settings-parity guard, gating even where the headless-Chrome panel boot can't.

### Known limitations
- **Multi-window**: if more than one IDE window runs Glass, all watch the same `~/.aios/spawn-inbox/` and race to consume a request; whichever wins acts, and a `send`/`kill` can miss if the winning window doesn't hold the target terminal. Single-window (the normal setup) is unaffected. Window-scoped ownership is a future change.

## [0.4.2] — 2026-07-23

> **The spawn-inbox command bus — agents can spawn, kill, and message sessions again, even in auto mode.** A recent Claude Code update gates agent-invoked `spawn`/`spawn-kill` (its auto-mode classifier reads them as "launch/kill an autonomous agent" and denies them — no prompt, just a silent red dot; and the osascript palette-drive they relied on leaked and dropped synthetic keystrokes). Glass now exposes a **command bus**: an orchestrating agent drops a small request file and Glass — a user-trusted extension — fulfils it **natively** (`vscode.createTerminal` / `sendText`), no synthetic keystrokes, no classifier gate. *Request, don't spawn.*

### Added
- **Spawn-inbox command bus** (`~/.aios/spawn-inbox/`). Glass watches the directory; drop a `*.json` file and Glass acts natively. **One channel, three verbs:**
  - **spawn** (default) — `{ "name": "<kebab>", "task": "<optional first prompt>", "model": "<id>" | "tier": "mechanical" | "judgment" }` → launches a named session via the same path as the **"Spawn a session"** button (collision-guarded: a live name is *revealed*, not duplicated). Optional **`model`/`tier`** lets the orchestrator pick the worker's model by cognitive load (*Calibrate-Don't-Choose* — mechanical → cheaper/faster, judgment → frontier); both are whitelisted before they reach the command line.
  - **kill** — `{ "action": "kill", "name": "<kebab>" }` → closes the worker's **terminal** (disposes the tab — SIGHUPs shell + claude + respawn loop), the same clean teardown as Glass's trash button, not merely a process kill.
  - **send** — `{ "action": "send", "name": "<kebab>", "prompt": "<text>" }` → delivers a prompt into that live session's terminal, so **one session can message another** (hand a task off, nudge a stuck worker) — inter-agent orchestration through the human-trusted extension.

  Requests are consumed (deleted) on pickup; malformed or name-less ones are ignored (logged to the *AIOS Glass* output channel); requests dropped while Glass was closed are drained on activation. This lets an agent *drive* Glass — which the sandbox + auto-mode classifier blocks it from doing directly — by writing a benign file the IDE then acts on, with **no synthetic keystrokes to leak or drop**. Pairs with the matching framework update (`/aios:update`): Glass marks its terminals (`AIOS_GLASS_TERM`) so the `spawn` wrapper boots the worker **in-place** there — no osascript, no command palette, no leaked keystrokes — even when the IDE inherited `$CLAUDECODE`; and sessions route through the bus when Glass is present and fail **loudly** (never silently) when it isn't.
- **Configurable kill behavior** — new **`aiosGlass.killBehavior`** setting for Glass's confirm-on-kill affordance (the Running-card trash button): `ask` (default — the **Capture & close · Kill now · Cancel** prompt), `kill` (always close immediately), or `capture` (always run `/close-session` first, keeping the work). The prompt itself now hints that it's configurable. (The command-bus `kill` verb stays deliberately non-interactive — it's for agent orchestration, not a human click.)

### Fixed
- **Glass-launched sessions now persist their transcript and appear in the Running card.** Every session Glass launches — rituals, skills, launch-primary, resume, commands, *and* spawn — is created in a terminal that **clears the inherited `CLAUDE_CODE_CHILD_SESSION` marker and forces session persistence**. Previously, when the IDE inherited that marker (e.g. it was launched from a Claude session), *every* Glass launch except "Spawn a session" came up with transcript saving OFF and stayed invisible to the Running card. Now they're all first-class, resumable, Glass-visible sessions.

## [0.4.1] — 2026-07-21

> **Close all your sessions in one move.** A new **"Close all"** button broadcasts `/close-session` to every live Claude session, so each wraps *itself* up — race-safe (each writes its own surface, every commit through `aios-commit`) — then returns to idle. Pick which sessions to close, see each one's live status, and optionally consolidate with `/close-day` and kill the terminals — your primary session is always protected.

### Added
- **"Close all" broadcast button** (title-bar door glyph — matches the per-session close icon; shown only when ≥1 session is running). Opens a **multi-select picker** of every live session — **all selected by default**, each row showing its true running-card **status dot** (🟢 idle · 🟡 working · 🔵 needs-input · 🔴 error), resolved from the session registry by pid-ancestry (not the terminal's display name, which often differs). Fires `/aios:close-session --auto` in each picked session (non-interactive self-close), so N sessions wrap up in parallel without clobbering: a vault session merge-appends its block under a per-file lock, a project session writes its own report, and every commit goes through `aios-commit`. Two **optional** post-actions: **run `/close-day`** (consolidates once, in your primary session — opens it if it isn't live) and **kill the terminals** (disposes every selected terminal *except* your primary, and only after each finishes capturing). **Requires the matching framework update** (`/aios:update`) for the `--auto` close-session + single-writer `/close-day`.

### Fixed
- **"Launch primary" now reveals a running primary instead of doing nothing.** It resolves the session by pid-ancestry (a terminal's display name often differs from the session name), so clicking it focuses your live primary the way clicking its running-card row does — the old name-only match silently no-op'd when the names differed.

## [0.4.0] — 2026-07-20

> The **organize-and-observe** release: sort any folder the way you want, a Health card that tells you what's wired, ISO week numbers on the calendar, and a session-management pass (post-its, a kill-guard, a localized Explorer). _(Backfilled — 0.4.0 shipped to Open VSX without a changelog entry.)_

### Added
- **Per-folder sort at any depth** (sort-model v2) — a master default plus per-folder overrides across every Explorer section, with a neutral sort glyph (hover-only). Folders reorder live on a sort flip — no collapse/expand.
- **Health card** — a Home-panel check that surfaces what's wired (Foam → skills/commands) and flags what isn't.
- **Calendar ISO week numbers** — `aiosGlass.showWeekNumbers` (default on), toggled from cog → Appearance, in both calendar views.
- **Session post-its (AI-18)** — jot a reminder on a live session from its row; view and delete the notes you created.

### Changed
- **Workspace folders now indent to match Vault/Framework** — they no longer read as a sub-level.
- **Dropped the AI-7 needs-input bucket** — redundant with native status `input` detection.

### Fixed
- **Kill-guard (AI-18)** — an explicit close always confirms first (kill is destructive + irreversible), harvesting any post-its so they aren't lost.
- **Explorer localized (AI-39)** — the file tree honors the language switcher (en · es · pt-br).

## [0.3.0] — 2026-06-25

> **AIOS Glass now speaks three languages.** Full **English / Español (neutral-LATAM) / Português (Brasil)** localization across the Home panel and every host popup, switchable from the cog menu **without an IDE reload**. Plus a one-click **Operating Manual** in the title bar, a unified **"open notes in"** setting that finally governs both Calendar and Explorer, and a more solid **"Go with agents"** task detector.

### Added
- **Localization — English · Español (neutral-LATAM) · Português (Brasil).** The whole Home panel *and* all host popups localize through one mechanism: the palette, the cog Config menu, Frequent tasks & routines, Reports, Companies / Collaboration, the skill / agent / command pickers, spawn, ingest, and the context browser. Auto-detects the IDE display language; a **new cog → Language switcher** (`aiosGlass.language`: auto / en / es / pt-br) overrides it and **re-renders the panel instantly — no IDE reload**. English stays baked in as the literal fallback, so a missing string degrades to English, never a blank. (~290 host strings + the full webview catalog, complete es + pt-br coverage.)
- **Operating Manual in the title bar.** A new `AIOS: Open Operating Manual` command opens the manual on the website (the-aios.com); reachable from a title-bar book glyph and from the Glass palette (`⌘⌥G *` → *Help & docs*). The README title-bar icon is now a distinct document glyph, so the two actions no longer look identical, and each ships light/dark variants so they're legible on both themes.

### Changed
- **One "Open notes in" setting now governs BOTH Calendar days and Explorer files** (`aiosGlass.openNotesIn`) — previously the Explorer ignored it. Two options: **Preview to the side** (default — Foam-rendered beside the source) or **Editor** (raw source — faster, skips the preview webview + whole-vault link resolution; lighter under memory pressure). ⌘/Ctrl-click always opens the source. Toggle from the cog menu. (Legacy full-tab `preview` migrates to preview-to-the-side.)
- **Workspaces card trimmed** — the redundant "Browse files" button is gone; the header folder glyph, the AIOS Explorer activity-bar icon, and the `⌘⌥G B` chord all still open Files.

### Fixed
- **"Go with agents" no longer over-counts.** The detector treated any line in the *Agents can handle* section that merely *mentioned* a backticked `/command` — the prose footer's `/ghost`, a `**Running now:**` status line — as a routed task, inflating the badge and picker. A routed task must now be a list item, so the count reflects only real tasks. Verified across 58 historical daily notes and locked with a regression test.

## [0.2.1] — 2026-06-18

> Two matching **workbench themes** so the whole IDE speaks Glass's palette, plus a fix for adding Workspace folders to the Explorer.

### Added
- **AIOS Dark + AIOS Light workbench themes** — pick them from *Preferences: Color Theme* (⌘K ⌘T). Built from the exact Glass tokens (deep-black / paper canvas, coral accent, `ok` green, the same gold/green/red git colours as the Explorer), so the editor, terminal, activity bar, and tabs read as one tool with the Glass panels. Terminal ANSI maps to the Glass family (bright-red = coral); cursor, active-tab underline, and badges carry the accent. Pair with `window.autoDetectColorScheme` to follow the OS the way Glass does.
- **Explorer auto-updates in place (IDE-style)** — create a file (e.g. save a screenshot into a Workspace folder) and the row appears on its own; delete one and it vanishes. Done via a **targeted re-list**: the root watcher reports *which* folder changed, and only that one folder is re-listed and row-diffed — no full repaint, so zero flicker; one `readdir` per change, so no memory cost; the live git-marker path is untouched. Folders that aren't expanded/visible are no-ops, so the write-heavy vault/framework roots don't thrash. A ⟳ title-bar action does a full preserve-expansion re-read as a manual catch-all.
- **Theme co-switch (opt-in, never hijacks)** — cog → *Theme (Glass + IDE)* → **AIOS Dark / AIOS Light** moves *both* Glass and the IDE theme together (the "move into AIOS" action). Once the IDE is on an AIOS theme, the header sun/moon toggle — and `window.autoDetectColorScheme` — flip the IDE in lockstep with Glass; picking an AIOS theme from ⌘K⌘T flips Glass too. The co-switch *only* fires when you're already on an AIOS theme, so a personal IDE theme (GitHub Dark, Tokyo Night…) is never touched. *Glass dark/light only* entries reskin the panels alone.
  - **Smart toggle.** While your IDE is on a non-AIOS theme, the header toggle asks each time — *Glass only* or *Glass + IDE* — so you're never trapped in one mode; the moment you pick *Glass + IDE* you're on an AIOS theme, and from then on the toggle co-switches both silently.

### Fixed
- **Adding a Workspace folder to the Explorer now refreshes immediately.** A lost directory-listing reply (a modal open-dialog could interrupt the round-trip) had no timeout, so the paint awaiting it hung *before* rendering the WORKSPACE group — the new folder only appeared after a delete-and-re-add. `fsList` now has a 5s safety net + idempotent resolve, so the tree can never be stranded; and adding a folder now expands to + selects it (instant feedback).

## [0.2.0] — 2026-06-18

> The visibility release. A **light theme** (same coral, paper canvas) you can toggle anywhere, and **AIOS Files** reborn as a real **Explorer** — a collapsible Framework / Vault / Workspace tree with **live git status**, an **IDE-style icon pack**, hidden-file control, and ⌘-click to source. Plus a quieter, glyph-driven header, a per-session memory read, and a focus fix so a follow-up Enter stops spawning duplicate terminals.

### Added
- **Light theme** — a paper-light variant of the Glass surfaces (canvas `#f7f7f5`, ink `#0c0c0d`, the **same coral accent**, with `accent-soft` darkened to `#d6402c` for legible coral text on white; the Launch CTA uses white text on coral in light). Toggle from the new header sun/moon button, the cog → *Theme*, or set `aiosGlass.theme`. One `body.light` class reskins every card and surface because every colour is now a token; the choice is a shared setting, so Home and the Files explorer stay in lockstep. Terminals stay dark, by design. (Dark remains the default — nothing changes unless you flip it.)
- **AIOS Explorer** — a tidy **collapsible file tree** in its own activity-bar container; open it from the explorer button in the Home header, `AIOS: Browse Files`, or `⌘⌥G B`. Three labelled sections differentiate the substrate at a glance — **FRAMEWORK** (AIOS infra: agents/skills/plugins/commands + the root docs; dimmer ring dot), **VAULT** (your notes — the primary surface, solid coral dot), **WORKSPACE** (external folders you add: repos, drives — `+` to add, each removable, persisted in `.glass/state.json`). Click a folder to expand inline, a file to open it; right-click any row → *Reveal in Finder*. Numbered-folder prefixes dimmed, build/noise dirs hidden, path access sandboxed to the section roots. It follows the global theme + secondary-hints settings (no toggles of its own). Horizontally compact so it shares the screen with Glass.
  - **Live git status, IDE-style** — across all three sections, changed files/folders are coloured with a trailing letter (modified `M` gold, untracked `U` / added `A` green, deleted `D` red); a dirty folder is flagged even when collapsed. Updates **live**: file-watchers on each section root (working-tree edits) + each repo's `.git/index` (commits/stages), debounced, plus a refresh when the view regains focus — the snapshot reconciles onto rendered rows without re-expanding. Watchers re-wire when you add/remove a **Workspace** folder, so an added repo gets live status immediately (not only after a reload). See where edits live, and watch it go clean after a commit/push.
  - **Hidden files toggle** — show/hide dotfiles (`.gitignore`, `.vscode`, `.github`, …) via cog → *Hidden files* or `aiosGlass.showHidden` (default off); `node_modules`, `.git`, build dirs and `.DS_Store` stay hidden regardless. The explorer also respects your workspace `files.exclude` globs.
  - **File-type icons** — an IDE-style pack: M↓ markdown, © license, plain NOTICE/txt, green-hexagon `package*.json`, TS badge (`.ts`/`tsconfig`), gold-braces json, JS/PY badges, blue-terminal PowerShell vs green-terminal shell, orange HTML, blue CSS, purple images, red PDF, canvas nodes, cyan-puzzle `.vsix`, red git. Plain ⇄ enhanced toggle (cog → *Explorer icons*, or `aiosGlass.fileIcons`).
  - **Open model — natural view by default, source on ⌘.** A plain click opens each file in its natural view: markdown → rendered preview, PDF/image → rendered, HTML → your browser (with a clear notification, on click *and* Enter), code/text → its source in a persistent tab. **⌘-click / ⌘-Enter** forces raw source for anything — so PDFs and notes stop dumping into source view unless you ask.
  - **Auto-reveal** (default on; `aiosGlass.autoReveal` / cog) — the tree follows the active editor tab, expanding to + selecting it, including PDF, image, and markdown-preview tabs (not just source).
  - **Find + navigate** — a *Find…* box (with a clear ✕ and `Esc`) runs a real search: it expands the whole tree to surface buried matches and keeps the ancestor chain. Keyboard nav (↑↓←→ / Enter) anchors on the selected row; **collapse-all** folds inner folders while leaving the top sections as they were; **⌥-click** opens a terminal at that path; right-click adds *Open terminal here · Send path to terminal · Copy path · Reveal in Finder*.
- **Home header** — a small logo + *AIOS Glass* wordmark top-left.
- **Go with agents, at hand** — a robot quick-action in the header toolbar (beside files · theme · compact) with a live count badge of the tasks your daily note delegates; one-click multi-spawn, same as the Daily card. The count is now **accurate** — it recognises a task done *anywhere* in the note (checkbox, strike, in-flight 🚀, or its canonical copy struck in another section), so finished work no longer inflates the badge.
- **Per-session memory** — the Running card shows each live session's RAM (its process tree's RSS, one `ps` scan per poll), styled as the quietest token in the row (dim mono), e.g. `… ready 1h · 1.6 GB`. Default on; toggle via cog → *Session memory* or `aiosGlass.showMemory` (off also skips the `ps` scan).

### Changed
- **Home header reorganised** — a small logo + *AIOS Glass* wordmark top-left, a quiet framework-status dot (`• up to date`, coral `• update available` when behind — click to run `/aios:update`) at the right of that row, and the actions below in two borderless-until-hover clusters grouped by frequency: **everyday** (files · theme · compact) on the left margin, **configure** (create · settings) on the right. *Settings* + *create-custom* moved in from the view title bar. De-weighting the row + grouping it fixed the "cockpit of equal buttons" feel.
- **View title bar trimmed** to two: a **book** (README) and the **?** — which now opens the **onboarding guide** (the friendly walk-me-through agent), since the toolbar's onboarding button is gone. Graph/create/config/files/ask all left the title bar (now in the header toolbar or the command palette; the cheatsheet stays in the palette + the on-panel *Key shortcuts* section).
- The Files explorer's section descriptors (*AIOS infra · your notes · external*) follow the **Secondary hints** toggle, like Home's hints.
- **Config (cog) menu grouped** — the flat list is now six labelled groups (*Appearance · Explorer · Claude · Session · Account · Help*), reordered by how often you reach for each.
- The webview smoke gate now boots **every** panel (home + files) in headless Chrome, not just Home.

- **Toggle buttons read by glyph, not colour** — no button stays accent; each is subtle at rest and accent only on hover. State lives in the icon: **files** = closed folder (hidden) ⇄ open folder (explorer open); **theme** = current mode (moon = dark, sun = light); **compact** = spacious blocks (comfortable) ⇄ dense rows (compact). Closing Files hides the primary sidebar first, so toggling it off no longer flashes the secondary bar where Home is usually docked.

### Fixed
- **The session kill (trash) icon turns a true red on hover** (grey at rest, like its siblings) — a deeper red than the coral accent so the destructive action is unmistakable and never reads as "just the accent."
- **Live sessions never show the grey "terminal/unknown" dot.** A session with a non-standard status (e.g. an `aios-shell` session reporting `shell`) fell through to the grey unknown dot, reading as a plain terminal. A registered session is alive → it now shows the green idle dot ("ready") unless it's explicitly busy / needs-input / error. (Grey stays reserved for actual terminals.)
- **A follow-up Enter no longer re-fires the button.** Action terminals now open **focused** (they were opened with `preserveFocus`), and the webview drops focus off a button after it dispatches — so pressing Enter after, e.g., *Resume* lands in the `claude --resume` picker instead of spawning a second terminal.

## [0.1.8] — 2026-06-11

> The hardening release: two live bugs fixed, the engineering debt from the
> standalone-roadmap audit paid down, and the onboarding walkthrough — born the
> same afternoon the audit named them.

### Fixed
- **Quick-card picks silently did nothing** (frequent tasks / skills / commands on the default `ask` terminal mode): all three menus dispatched from inside `onDidAccept`, and the dying picker's async hide/dispose dismissed the follow-up "Run in…" picker before it could render. Selections now dispatch from `onDidHide`. Same fix applied to the wildcard palette.
- **Type-to-filter flicker** in those pickers — the item list was rebuilt on every keystroke, resetting the highlighted row; the dynamic *Create task / Ask AIOS* fallbacks are now stable items toggled only when the query goes empty↔typed.
- **Dead surfaces removed**: the four `AIOS: Refresh …` Command-Palette entries (pre-panel relics that errored on click) and the welcome block for a view that no longer exists. Inverse bug too: **Ask AIOS, Frequent Tasks & Routines, and the palette are now actually in the Command Palette**.
- **Tooltips and hover states survive the live poll** — the panel re-rendered the session/terminal lists and re-assigned the quota tooltip every 2s even when nothing changed, tearing down native tooltip dwell and hover mid-gesture. DOM now updates only on change.

### Added
- **Getting Started walkthrough** — six branded steps (dock the panel → connect your AIOS → first ritual → Ask AIOS → agents → chords) with one-click actions and completion tracking. Opens automatically on install and from cog → *Getting started*. (The walkthrough button had pointed at a walkthrough that never existed.)
- **Diagnostics channel** — action failures (a click that does nothing, a failed launch, a state write error) now log to the *AIOS Glass* output channel with context. Open via cog → *Show logs* or `AIOS: Show Logs`; an activation banner explains that an empty channel = healthy.
- **Quota reset countdown** — when 5h usage enters the amber zone (≥85%) the label itself shows when capacity returns (`5h 92% · resets in 32m`); the tooltip carries both windows, one row each.

### Changed
- **Tasks & routines now live in your vault** (`.glass/state.json`) instead of per-machine storage — they follow you across machines via the vault's own git sync. Existing values migrate automatically on first read; nothing to do.
- **Internals hardened** (the audit's Phase 0): the panel UI extracted from a 1,160-line template literal into real `media/home.{html,css,js}` files; a **CI smoke gate** boots the actual panel in headless Chrome and fails on any script error (the bug class that shipped a dead panel can't ship again); a pure, vscode-free `src/core/` with **12 unit tests** (zero new dependencies); a 5s cache on the agents/commands/skills discovery walks.

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
