# Security Policy

## Supported versions

KeelDB is pre-1.0 and moves quickly. Security fixes land on the latest release and `main`.

| Version | Supported |
| ------- | --------- |
| latest release / `main` | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, discussions, or pull requests.**

Report privately using either:

1. **GitHub Private Vulnerability Reporting** — go to the repository's **Security** tab →
   **"Report a vulnerability"** ([Security Advisories](https://github.com/md-golamrabbani/keeldb/security/advisories/new)).
   This is the preferred channel.
2. If that is unavailable, open a minimal issue titled *"Security contact request"* (no details) and a
   maintainer will provide a private channel.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version / commit and platform.

We aim to acknowledge reports within a few days and will keep you updated on the fix. Please give us a
reasonable window to release a patch before any public disclosure. We're happy to credit you in the release
notes if you'd like.

## Handling of secrets

KeelDB stores connection secrets (DB passwords, connection strings, SSH keys) **Fernet-encrypted at rest**
in the git-ignored `data/` directory (`data/key.bin`, mode `0600`). Secrets are never returned by the API and
never logged. Never commit your `data/` directory or share `data/key.bin`.
