# AIOS Glass

A friendly **glass layer over the [AIOS](https://github.com/The-AIOS/aios)** — run rituals, browse agents, manage spaces, and navigate your vault, all from inside [Google Antigravity](https://antigravity.google) (or any VS Code-compatible editor).

> **Glass, not engine.** AIOS Glass never reimplements the AIOS. It *surfaces* and *triggers* what already exists — your slash commands, your `spawn` workers, your company/collaborate syncs. The brain stays in the framework; this is the clickable window onto it. The terminal becomes optional, not required.

## Why

The AIOS is powerful but lives behind the terminal: slash commands you type, the `spawn` wrapper, git pulls. That's a wall for non-developers. AIOS Glass turns each ritual into a button, each argument into a form field, each agent into a click — so anyone can operate their AIOS from a graphical surface.

## Relationship to Foam

AIOS Glass **depends on [Foam](https://github.com/foambubble/foam)** (declared as an `extensionDependency`, auto-installed from Open VSX) for the vault-navigation layer — wikilinks, backlinks, and graph view. AIOS Glass adds the *operating-system control plane* on top:

- **Rituals** — run `/aios:*` commands via native Claude Code _(Phase 1 — shipped)_
- **Calendar** — vault-aware daily notes _(Phase 2)_
- **Agents** — browse + spawn native-Claude workers _(Phase 3)_
- **Capabilities** — skills / MCPs / plugins _(Phase 4)_
- **Spaces** — `/company` + `/collaborate`, args as forms _(Phase 5)_
- **Status** — framework updates + company syncs _(Phase 5)_
- **Onboarding** — guided walkthrough for a fresh clone _(Phase 6)_

We depend on Foam rather than forking it deliberately — Foam stays the engine and auto-updates upstream; we stay glass.

## Develop

```bash
npm install
npm run watch        # or: npm run compile
```

Then press **F5** ("Run AIOS Glass — Extension Dev Host"). A second editor window opens with your vault (`~/obsidian`) loaded and the **AIOS** activity-bar icon active.

### How Rituals work

The **Rituals** view reads the live `plugins/aios/commands/*.md` directory of your framework at runtime — it never hardcodes the command list, so anything `/aios:update` adds shows up automatically. Clicking a ritual launches `claude "/aios:<name>"` in an integrated terminal. Commands with an `argument-hint` prompt for arguments first.

Configure the framework location with **`aiosGlass.frameworkPath`** (default `~/aios`).

## License

GPL-2.0-or-later © The AIOS contributors — same license as the [AIOS framework](https://github.com/The-AIOS/aios).
