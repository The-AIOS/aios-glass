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
5. **Add the token as a secret of the `release` environment** (never a repository secret) so the Action can publish:
   ```bash
   gh secret set OVSX_TOKEN --env release --repo The-AIOS/aios-glass
   ```
   (it prompts for the value, so the token stays out of your shell history; or GitHub → repo *Settings* → *Environments* → `release` → *Add environment secret*.)

   **Why an environment.** Anyone with write access can push a branch, and a workflow on that branch can read every repository secret. The `release` environment hands `OVSX_TOKEN` only to the publish job, only when it runs from `main` or a `v*` tag, and only after the owner approves the run.

That's it — never repeated.

---

## Releasing an update (every time)

1. Make your changes.
2. **Bump the version** in `package.json` (e.g. `0.1.0` → `0.1.1`). Open VSX rejects re-publishing the same version, so this must increment.
3. Land the change on `main` through a pull request (`main` accepts no direct push and needs an approving review).
4. **The owner tags the merge commit** (only the owner can create `v*` tags):
   ```bash
   git tag -a v0.1.1 -m "AIOS Glass 0.1.1" <merge-commit>
   git push origin v0.1.1
   ```
5. The **Publish to Open VSX** run waits for approval: open it → *Review deployments* → `release` → *Approve and deploy*. It then packages and publishes. Teammates auto-update.

> The tag is just the trigger; the version that actually publishes is whatever `package.json` says — keep the tag and `package.json` version in sync.

**Manual run:** Actions tab → *Publish to Open VSX* → *Run workflow* from `main` (uses the current `package.json` version; other branches are refused, and the run waits for the owner's approval). Useful for the very first publish after setup.

---

## How teammates install (once it's on Open VSX)

Open the Extensions view → search **"AIOS Glass"** → Install. This pulls it from Open VSX, **auto-installs the Foam dependency**, and **enables auto-updates**. The `.vsix` sideload in [INSTALL.md](INSTALL.md) stays as the offline / pre-publish fallback.
