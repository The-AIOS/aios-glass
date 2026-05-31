# Installing AIOS Glass

A graphical "glass layer" over the AIOS — run rituals, launch agents, browse skills/commands, manage spaces, and watch your second brain compound, all from inside the IDE. **Glass, not engine:** it surfaces and triggers your existing AIOS; it reimplements nothing.

Glass is published on the **[Open VSX Registry](https://open-vsx.org/extension/the-aios/aios-glass)**, so in an Open VSX–backed editor (Antigravity, VSCodium, Cursor, Windsurf) you install it straight from the Extensions view — two minutes, and it auto-updates from then on. A `.vsix` sideload is the fallback. Stock Microsoft VS Code uses its own marketplace, where Glass is **not** published — sideload the `.vsix` there.

---

## Prerequisites

1. **Antigravity IDE** (or any recent VS Code ≥ 1.85) — Glass uses the Open VSX registry.
2. **Claude CLI** installed and signed in — `claude` must be on your `PATH` (Glass launches it). Check: `claude --version`.
3. **The AIOS framework** set up at **`~/aios`** (your vault). Glass reads it at runtime — rituals, agents, daily notes, observed context all come from there. If yours lives elsewhere, see *Configuration* below.
4. **Foam** extension (`foam.foam-vscode`) — Glass depends on it for the markdown/wikilink layer. Install it first from the Extensions view (search "Foam"), or the Glass install will prompt for it.

---

## Install

> **Preferred — from Open VSX (auto-updates):** open the Extensions view → search **"AIOS Glass"** → **Install**. This pulls it from the registry, **auto-installs Foam** (the dependency), and **keeps you on auto-update** — every future release lands on its own. Use this on any Open VSX–backed editor and skip the `.vsix` steps below.
>
> CLI equivalent: `<editor-cli> --install-extension the-aios.aios-glass` (e.g. `~/.antigravity-ide/antigravity-ide/bin/agy-ide --install-extension the-aios.aios-glass`).

**`.vsix` sideload (offline / stock VS Code fallback):** download `aios-glass-<version>.vsix` from the latest [GitHub Release](https://github.com/The-AIOS/aios-glass/releases).

**Option A — UI (easiest)**
1. Open the Extensions view (`⌘⇧X` / `Ctrl+Shift+X`).
2. Click the `⋯` menu (top-right of the Extensions panel) → **Install from VSIX…**
3. Pick the downloaded `.vsix`.
4. **Reload the window** when prompted (`⌘⇧P` → *Developer: Reload Window*).

**Option B — CLI**
```bash
# Antigravity:
~/.antigravity-ide/antigravity-ide/bin/agy-ide --install-extension aios-glass-<version>.vsix
# or plain VS Code:
code --install-extension aios-glass-<version>.vsix
```
Then reload the window.

---

## First run

1. Open the command palette (`⌘⇧P`) → **AIOS Glass: Open Home** (or click the AIOS mark in the activity/secondary side bar).
2. Dock it where you like — it works well in the secondary side bar (drag the view there, or *View: Move View*).
3. You should see your **Daily Ritual** card, **Calendar**, **Quick** actions, **Sessions Running**, **Workspaces**, and the context cards. The panel header carries the framework-update badge, a **density/compact** toggle, and the **onboarding** guide; the view's **title bar** (top-right) carries the **graph**, **＋ new custom**, **cog (config)**, and **? cheatsheet** actions.

If the cards are empty, Glass can't find your vault — see Configuration.

---

## Configuration

- **Vault not at `~/aios`?** Setting → `aiosGlass.frameworkPath` (point it at your AIOS root).
- **Where actions run** → the **cog** (config menu): Terminal mode `ask` (pick a terminal each time) or `active` (use your focused terminal). Also: model, permission mode, login/logout, and the `/goal` · `/fewer-permission-prompts` · `/schedule` shortcuts.
- **Compact view** → the palette icon in the header tightens spacing so more fits on screen.

---

## Updating

**Installed from Open VSX?** Nothing to do — your IDE auto-updates on the next refresh.

**Sideloaded the `.vsix`?** Updates are manual: download the newer `.vsix` from [Releases](https://github.com/The-AIOS/aios-glass/releases) and re-run the install (Option A or B) — it overwrites the old version. Reload the window. (Switching to the Open VSX install gets you auto-updates.)

*(Your AIOS **content** updates separately, via `/aios:update` inside a session — that's a different channel from the Glass extension itself.)*

---

## Troubleshooting

- **"Depends on Foam"** on install → install the Foam extension first, then retry.
- **Buttons open a terminal but nothing runs** → make sure `claude` is on your `PATH` (`which claude`).
- **Empty Home / wrong vault** → set `aiosGlass.frameworkPath`.
- **Nothing happens on click in `ask` terminal mode** → you're being asked which terminal to use; pick one (or switch to `active` in the cog).
