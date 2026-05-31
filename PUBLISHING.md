# Publishing AIOS Glass (maintainers)

AIOS Glass auto-publishes to **[Open VSX](https://open-vsx.org)** (the registry Antigravity / VS Code-OSS use). Once a teammate has installed Glass *from Open VSX*, every tagged release **auto-updates on their IDE** — they do nothing.

The publish is automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml): it fires on any `vX.Y.Z` tag (or a manual run) and pushes the build to Open VSX.

---

## One-time setup (do this once)

1. **Sign in** to <https://open-vsx.org> with GitHub.
2. **Sign the publisher agreement** — Open VSX requires the Eclipse publisher agreement once (it prompts you on first publish / from your user settings).
3. **Generate an access token** — open-vsx.org → your avatar → *Settings* → *Access Tokens* → generate one. Copy it.
4. **Create the namespace** (must match `package.json` → `publisher`, i.e. `the-aios`):
   ```bash
   npx --yes ovsx create-namespace the-aios -p <YOUR_TOKEN>
   ```
5. **Add the token as a repo secret** so the Action can publish:
   ```bash
   gh secret set OVSX_TOKEN --repo The-AIOS/aios-glass --body "<YOUR_TOKEN>"
   ```
   (or GitHub → repo *Settings* → *Secrets and variables* → *Actions* → New secret `OVSX_TOKEN`.)

That's it — never repeated.

---

## Releasing an update (every time)

1. Make your changes.
2. **Bump the version** in `package.json` (e.g. `0.1.0` → `0.1.1`). Open VSX rejects re-publishing the same version, so this must increment.
3. Commit, then tag + push:
   ```bash
   git commit -am "feat: <what changed>"
   git tag v0.1.1
   git push origin main --tags
   ```
4. The **Publish to Open VSX** Action runs → packages → publishes. Teammates auto-update.

> The tag is just the trigger; the version that actually publishes is whatever `package.json` says — keep the tag and `package.json` version in sync.

**Manual run:** Actions tab → *Publish to Open VSX* → *Run workflow* (uses the current `package.json` version). Useful for the very first publish after setup.

---

## How teammates install (once it's on Open VSX)

Open the Extensions view → search **"AIOS Glass"** → Install. This pulls it from Open VSX, **auto-installs the Foam dependency**, and **enables auto-updates**. The `.vsix` sideload in [INSTALL.md](INSTALL.md) stays as the offline / pre-publish fallback.
