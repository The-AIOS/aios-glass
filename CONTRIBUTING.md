# Contributing to AIOS Glass

**Read the framework's guide first:
[The-AIOS/aios → CONTRIBUTING.md](https://github.com/The-AIOS/aios/blob/main/CONTRIBUTING.md).**
It is the single source for the rules that apply everywhere: the fork-and-PR flow, the `custom/`
rule, what every AIOS session must keep, commit format, licensing and the no-personal-content
discipline. This file adds only what is specific to Glass.

> **Glass, not engine.** Glass *surfaces and triggers* your existing AIOS; it reimplements nothing. Read the framework at runtime and don't fork its logic into the extension. If a change would duplicate framework behaviour, it probably belongs in the framework, not here.

## Before you build

- **Look for it first.** Search open and recently closed
  [issues](https://github.com/search?q=org%3AThe-AIOS+is%3Aissue&type=issues) and
  [pull requests](https://github.com/search?q=org%3AThe-AIOS+is%3Apr&type=pullrequests) across
  the organisation, and check the
  [work in flight](https://github.com/search?q=org%3AThe-AIOS+is%3Aopen+label%3A%22status%3A+in-progress%22&type=issues):
  issues labelled `status: in-progress`, and open or draft PRs. The labels are the only status
  source. `duplicate-in-flight` on an issue means it is already being built elsewhere.
- **If something matches, comment there** instead of opening a new one. One line claiming an
  issue before you build can save you a whole PR.
- **Titles.** An issue title reads `Area: what changes`, in under about 70 characters. The area is
  the surface a reader recognises (`Chat view:`, `Setup:`, `Status line:`). After the colon, a
  feature says what is true when it's done; a bug says what goes wrong as the user sees it. No
  type prefixes like `[bug]` or `feat:`, since the `type:` label carries that. Conventional
  Commits stay in commit messages and PR titles.
- **No internal tracking keys or personal names** in commit messages, PR titles, PR bodies or
  issue comments. Refer to issues and PRs by number.

## Is this the right repo?

This is the IDE extension: the Glass panel, its commands and terminals inside VS Code-family
editors, and how Glass fulfils the spawn inbox. A change there belongs here, even when it changes
how a command behaves.

A change to an agent, skill, command, hook or template belongs in
[The-AIOS/aios](https://github.com/The-AIOS/aios). A change to the desktop app belongs in
[The-AIOS/aios-app](https://github.com/The-AIOS/aios-app). Glass and the App implement the same
spawn-inbox protocol separately, so a fix to one usually needs a matching PR in the other: say so
in your PR and a maintainer will help line them up.

## Getting it running

```bash
npm ci            # install dependencies (uses package-lock.json)
npm run watch     # recompile on change while developing
```

To try it live, open this folder in an Open VSX–backed editor (Antigravity, VSCodium, Cursor, Windsurf) and press **F5** to launch an Extension Development Host with Glass loaded. See [`INSTALL.md`](./INSTALL.md) for prerequisites (Claude CLI on `PATH`, an AIOS framework at `~/aios`, the Foam extension).

## The gates

```bash
npm test          # type-check, compile, then the unit tests
npm run smoke     # boots the real panel in headless Chrome and fails on any script error
```

Run both before you open a PR. They catch different things: the panel's script ships as plain
files that `tsc` never reads, so a bug that kills the panel at load compiles green and passes
`npm test`. Only `npm run smoke` sees it.

## Keep it self-contained

The extension reads everything it needs from the AIOS at runtime. Don't hard-code vault-specific
content, paths or names; use generic placeholders (`~/aios`, `you@example.com`) in examples.

## Releases

Maintainers release by pushing a `vX.Y.Z` tag, which publishes to the
[Open VSX Registry](https://open-vsx.org/extension/the-aios/aios-glass). Glass ships to Open VSX
only.

## License

GPL-2.0-or-later, matching the framework and the App (see [`LICENSE`](./LICENSE)). By contributing
you agree your work ships under those terms.
