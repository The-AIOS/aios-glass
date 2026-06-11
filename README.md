# AIOS Glass

[![Open VSX](https://img.shields.io/open-vsx/v/the-aios/aios-glass?label=Open%20VSX&color=ff5d4d)](https://open-vsx.org/extension/the-aios/aios-glass)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/the-aios/aios-glass?label=downloads)](https://open-vsx.org/extension/the-aios/aios-glass)
[![CI](https://github.com/The-AIOS/aios-glass/actions/workflows/ci.yml/badge.svg)](https://github.com/The-AIOS/aios-glass/actions/workflows/ci.yml)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue)](./LICENSE)

A friendly **glass layer over the [AIOS](https://github.com/The-AIOS/aios)** — run rituals, browse agents, manage spaces, and navigate your vault, all from inside [Google Antigravity](https://antigravity.google) (or any VS Code-compatible editor).

> **Glass, not engine.** AIOS Glass never reimplements the AIOS. It *surfaces* and *triggers* what already exists — your slash commands, your `spawn` workers, your company/collaborate syncs. The brain stays in the framework; this is the clickable window onto it. The terminal becomes optional, not required.

## Why

The AIOS is powerful but lives behind the terminal: slash commands you type, the `spawn` wrapper, git pulls. That's a wall for non-developers. AIOS Glass turns each ritual into a button, each argument into a form field, each agent into a click — so anyone can operate their AIOS from a graphical surface.

## What you get

- **✨ Ask AIOS** — type what you need; *Claude matches your ask to the right context & tools in your AIOS — and puts them to work.* A first-class button, the `⌘⌥G Q` chord, and a fallback in every picker: a search that matches nothing resolves by meaning instead of dead-ending.
- **Home dashboard** — daily-ritual buttons, contextual nudges, a month/week calendar, and a live **Sessions & Terminals hub**: status dots that breathe while a session works, per-row interrupt / close-session / kill, one-line rows with duration + project. Cards collapse, reorder (`Alt+↑/↓`, Daily pinned), and navigate by keyboard.
- **Quick tasks & routines** — one-click frequent tasks (agent / command / skill / prompt, with a baked assignment) and **routines**: ordered task bundles that run as a single session. Searches that find nothing offer *Create task*.
- **`⌘⌥G` chords + the `*` palette** — 20 shortcuts behind one leader with an on-panel cheat-sheet, plus a wildcard palette that fuzzy-searches everything launchable: sessions, routines, tasks, agents, commands, skills.
- **Status, live** — framework-update badge that re-checks the moment your tracker changes, rate-limit meter, company/collaborate surfaces.
- **Guided start + diagnostics** — a six-step Getting Started walkthrough on install, and an *AIOS Glass* output channel where any action failure lands with context (cog → *Show logs*).

## Relationship to Foam

AIOS Glass **recommends [Foam](https://github.com/foambubble/foam)** for the vault-navigation layer — `[[wikilinks]]` rendering, backlinks, and graph view. It's an *optional* companion (Glass prompts to install it on first run): Glass works without it, and it's deliberately **not** a hard `extensionDependency` so Glass installs cleanly on editors whose engine predates the latest Foam (e.g. stock Antigravity). AIOS Glass adds the *operating-system control plane* on top:

- **Rituals** — run `/aios:*` commands via native Claude Code
- **Calendar** — vault-aware daily notes
- **Agents** — browse + spawn native-Claude workers
- **Capabilities** — skills / MCPs / plugins
- **Spaces** — `/company` + `/collaborate`, args as forms
- **Status** — framework updates + company syncs
- **Onboarding** — guided walkthrough for a fresh clone

We lean on Foam rather than forking it deliberately — Foam stays the engine and auto-updates upstream; we stay glass. (Soft dependency, not hard: a stuck/old Foam never blocks Glass from activating.)

## Develop

```bash
npm install
npm run watch        # or: npm run compile
```

Then press **F5** ("Run AIOS Glass — Extension Dev Host"). A second editor window opens with your vault loaded and the **AIOS** activity-bar icon active.

### How Rituals work

The **Rituals** view reads the live `plugins/aios/commands/*.md` directory of your framework at runtime — it never hardcodes the command list, so anything `/aios:update` adds shows up automatically. Clicking a ritual launches `claude "/aios:<name>"` in an integrated terminal. Commands with an `argument-hint` prompt for arguments first.

Configure the framework location with **`aiosGlass.frameworkPath`** (default `~/aios`).

## License

GPL-2.0-or-later © The AIOS contributors — same license as the [AIOS framework](https://github.com/The-AIOS/aios).
