# Security Policy

## Supported versions

AIOS Glass is distributed through the [Open VSX Registry](https://open-vsx.org/extension/the-aios/aios-glass) and auto-updates. Only the **latest published version** is supported — please update before reporting.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab → **Report a vulnerability**. This opens a private advisory visible only to the maintainers.

Please include:
- A description of the issue and its impact.
- Steps to reproduce (redact any personal data, tokens, or paths).
- The Glass version and editor you're running.

## Scope notes

- Glass is a **glass layer** — it launches your local Claude CLI and reads your AIOS at runtime. It stores no credentials of its own; account/auth state lives in Claude Code's own files.
- The publishing token (`OVSX_TOKEN`) lives only as a GitHub Actions secret and is never committed.

We'll acknowledge a valid report and coordinate a fix and disclosure timeline with you.
