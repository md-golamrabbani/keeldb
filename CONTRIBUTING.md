# Contributing to KeelDB

Thanks for your interest in improving KeelDB! This guide covers how to set up a dev environment,
the conventions we follow, and how to get a change merged.

## Ways to contribute

- 🐛 **Report bugs** — open an [issue](https://github.com/md-golamrabbani/keeldb/issues/new/choose)
  with steps to reproduce.
- 💡 **Suggest features** — open a feature request; describe the problem, not just a solution.
- 🛠️ **Send a pull request** — fixes, features, docs, or tests are all welcome.
- ⭐ **Star the repo** and share it — it genuinely helps.

## Development setup

**Prerequisites:** Python 3.11+, Node.js 20+ (and Rust + Tauri prerequisites only if you build the desktop app).

```bash
# 1. Fork, then clone your fork
git clone https://github.com/<you>/keeldb.git
cd keeldb

# 2. Backend (FastAPI on :8000)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8000 --reload

# 3. Frontend (Next.js on :3000) — in a second terminal
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. See the [README](README.md#-run-from-source) for more, and
[docs/DESKTOP.md](docs/DESKTOP.md) for building the native app.

## Before you open a PR

Run the checks locally — CI runs the same ones:

```bash
# Backend
cd backend && .venv/bin/pytest -q

# Frontend
cd frontend && npm run typecheck && npm run build
```

- Keep changes focused; one logical change per PR.
- Add or update tests for behavior changes (backend tests live in `backend/tests/`).
- Update docs / the README when you change user-facing behavior.
- Match the surrounding code style — the codebase favors small, well-named functions and comments that
  explain *why*, not *what*.

## Commit & PR conventions

- Write clear, imperative commit subjects (e.g. `Fix double scrollbar in Data tab`).
- Reference issues in the body (`Fixes #123`).
- Open the PR against `main`; fill in the PR template.
- A maintainer will review; please be responsive to feedback.

## Project layout

```
backend/app/
  connectors/    # base reflection + keyset reads + SSH tunnel; mysql, postgres, sqlfile
  sqlimport/     # tolerant SQL-dump parser (keeps PKs+FKs) -> SQLite loader
  transform/     # casts, sandboxed expressions, uuid generation
  api/           # FastAPI routers (connections, migrate, explorer, admin, ...)
  dbops.py       # Explorer data ops (read_table, row CRUD, export/import)
  runner.py      # batched read -> transform -> sink, progress, reconciliation
frontend/
  app/           # routes: /, /explorer, /migrate, /diagrams, /toolkit, ...
  components/    # UI incl. components/explorer/* (DataGrid, SqlEditor, ERD, ...)
  lib/           # API client, zustand stores, helpers
```

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
