# Contributing to AIOS Glass

Thanks for your interest in improving AIOS Glass — the graphical "glass layer" over the [AIOS framework](https://github.com/The-AIOS/aios). Contributions are welcome.

> **Glass, not engine.** Glass *surfaces and triggers* your existing AIOS; it reimplements nothing. Keep changes on the glass side — read the framework at runtime, don't fork its logic into the extension. If a change would duplicate framework behavior, it probably belongs in the framework, not here.

## How to contribute

The repo is public — you don't need write access. Use the standard fork-and-PR flow:

1. **Fork** `The-AIOS/aios-glass` to your account.
2. **Branch** off `main` (`git checkout -b fix/short-description`).
3. Make your change, keeping the [build green](#local-development).
4. **Open a PR** against `The-AIOS/aios-glass:main`. CI runs automatically (build + package + secret scan) on every PR, including from forks.

For anything non-trivial, **open an issue first** to align on the approach before you build.

## Local development

```bash
npm ci          # install dependencies (uses package-lock.json)
npm run compile # type-check + compile (tsc) — this is the CI gate
npm run watch   # recompile on change while developing
```

To try it live: open this folder in an Open VSX–backed editor (Antigravity, VSCodium, Cursor, Windsurf) and press **F5** to launch an Extension Development Host with Glass loaded. See [`INSTALL.md`](./INSTALL.md) for prerequisites (Claude CLI on `PATH`, an AIOS framework at `~/aios`, the Foam extension).

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, etc.
- **No personal data.** This is a public, shareable extension: never commit secrets, tokens, real emails, names, or environment-specific paths. Use generic placeholders (`you@example.com`, `~/aios`) in examples and comments. The CI secret scan will flag obvious secrets, but personal specifics are on you to keep out.
- **Match the surrounding style** — comment density, naming, and idiom.
- **Keep it self-contained** — the extension must read everything it needs from the AIOS at runtime; don't hard-code vault-specific content.

## Releases

Releases are tag-driven. Pushing a `vX.Y.Z` tag triggers the publish workflow, which packages the extension and pushes it to the [Open VSX Registry](https://open-vsx.org/extension/the-aios/aios-glass) (skipping cleanly if that version is already published). Users installed from Open VSX auto-update on their next IDE refresh.

## License

By contributing, you agree your contributions are licensed under **GPL-2.0-or-later**, the same license as the project (see [`LICENSE`](./LICENSE)).
