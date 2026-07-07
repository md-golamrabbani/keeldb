"""Local JSON persistence. Secrets (password, connection string, service-role
key) are Fernet-encrypted at rest with a machine-local key file (0600).
Passwords are never returned by the API and never logged."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

from ..models import (
    AlertRule,
    ConnectionProfileIn,
    HistoryEntry,
    MappingProfile,
    MigrationProject,
    SavedConnection,
    Snippet,
)

DATA_DIR = Path(os.environ.get("DBMS_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
_SECRET_FIELDS = (
    "password",
    "connection_string",
    "service_role_key",
    "ssh_password",
    "ssh_private_key",
)


def _fernet() -> Fernet:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key_file = DATA_DIR / "key.bin"
    if not key_file.exists():
        key_file.write_bytes(Fernet.generate_key())
        key_file.chmod(0o600)
    return Fernet(key_file.read_bytes())


class _JsonStore:
    filename = "store.json"

    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.path = DATA_DIR / self.filename

    def _load(self) -> dict[str, dict]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text())

    def _save(self, items: dict[str, dict]) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, indent=2, default=str))
        tmp.replace(self.path)


class ConnectionStore(_JsonStore):
    filename = "connections.json"

    def __init__(self) -> None:
        super().__init__()
        self._fernet = _fernet()

    def _encrypt(self, record: dict) -> dict:
        out = dict(record)
        for f in _SECRET_FIELDS:
            if out.get(f):
                out[f] = self._fernet.encrypt(out[f].encode()).decode()
        return out

    def _decrypt(self, record: dict) -> dict:
        out = dict(record)
        for f in _SECRET_FIELDS:
            if out.get(f):
                out[f] = self._fernet.decrypt(out[f].encode()).decode()
        return out

    def list(self) -> list[SavedConnection]:
        return [SavedConnection(**self._decrypt(r)) for r in self._load().values()]

    def get(self, conn_id: str) -> Optional[SavedConnection]:
        r = self._load().get(conn_id)
        return SavedConnection(**self._decrypt(r)) if r else None

    def create(self, profile: ConnectionProfileIn) -> SavedConnection:
        record = SavedConnection(id=str(uuid.uuid4()), **profile.model_dump())
        return self.add(record)

    def add(self, record: SavedConnection) -> SavedConnection:
        """Persist a fully-formed record (used for sqlfile imports)."""
        items = self._load()
        items[record.id] = self._encrypt(record.model_dump())
        self._save(items)
        return record

    def update(self, conn_id: str, profile: ConnectionProfileIn) -> Optional[SavedConnection]:
        items = self._load()
        if conn_id not in items:
            return None
        existing = self._decrypt(items[conn_id])
        data = profile.model_dump()
        # Empty secret fields on update mean "keep the stored secret".
        for f in _SECRET_FIELDS:
            if not data.get(f):
                data[f] = existing.get(f, "")
        record = SavedConnection(id=conn_id, **data)
        items[conn_id] = self._encrypt(record.model_dump())
        self._save(items)
        return record

    def delete(self, conn_id: str) -> bool:
        items = self._load()
        if conn_id not in items:
            return False
        # Clean up an imported SQL file's SQLite database.
        record = items[conn_id]
        sqlite_path = record.get("sqlite_path")
        if sqlite_path:
            try:
                Path(sqlite_path).unlink()
            except OSError:
                pass
        del items[conn_id]
        self._save(items)
        return True


class MappingStore(_JsonStore):
    filename = "mappings.json"

    def list(self) -> list[MappingProfile]:
        return [MappingProfile(**r) for r in self._load().values()]

    def get(self, mapping_id: str) -> Optional[MappingProfile]:
        r = self._load().get(mapping_id)
        return MappingProfile(**r) if r else None

    def save(self, mapping: MappingProfile) -> MappingProfile:
        if not mapping.id:
            mapping.id = str(uuid.uuid4())
        items = self._load()
        items[mapping.id] = mapping.model_dump()
        self._save(items)
        return mapping

    def delete(self, mapping_id: str) -> bool:
        items = self._load()
        if mapping_id not in items:
            return False
        del items[mapping_id]
        self._save(items)
        return True


class ProjectStore(_JsonStore):
    filename = "projects.json"

    def list(self) -> list[MigrationProject]:
        return [MigrationProject(**r) for r in self._load().values()]

    def get(self, project_id: str) -> Optional[MigrationProject]:
        r = self._load().get(project_id)
        return MigrationProject(**r) if r else None

    def save(self, project: MigrationProject) -> MigrationProject:
        if not project.id:
            project.id = str(uuid.uuid4())
        items = self._load()
        items[project.id] = project.model_dump()
        self._save(items)
        return project

    def delete(self, project_id: str) -> bool:
        items = self._load()
        if project_id not in items:
            return False
        del items[project_id]
        self._save(items)
        return True


class SnippetStore(_JsonStore):
    filename = "snippets.json"

    def list(self) -> list[Snippet]:
        items = sorted(self._load().values(), key=lambda r: r.get("created_at", ""), reverse=True)
        return [Snippet(**r) for r in items]

    def get(self, snippet_id: str) -> Optional[Snippet]:
        r = self._load().get(snippet_id)
        return Snippet(**r) if r else None

    def save(self, snippet: Snippet) -> Snippet:
        if not snippet.id:
            snippet.id = str(uuid.uuid4())
        if not snippet.created_at:
            snippet.created_at = datetime.now(timezone.utc).isoformat()
        items = self._load()
        items[snippet.id] = snippet.model_dump()
        self._save(items)
        return snippet

    def delete(self, snippet_id: str) -> bool:
        items = self._load()
        if snippet_id not in items:
            return False
        del items[snippet_id]
        self._save(items)
        return True


class HistoryStore(_JsonStore):
    """Recent executed queries, newest first, capped. Stored as a JSON list."""
    filename = "history.json"
    MAX = 200

    def _load_list(self) -> list[dict]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text())
        return data if isinstance(data, list) else []

    def record(self, entry: HistoryEntry) -> HistoryEntry:
        if not entry.id:
            entry.id = str(uuid.uuid4())
        if not entry.ran_at:
            entry.ran_at = datetime.now(timezone.utc).isoformat()
        items = self._load_list()
        # Skip consecutive duplicates (same connection re-running the same SQL).
        if items and items[0].get("sql") == entry.sql and items[0].get("conn_id") == entry.conn_id:
            return entry
        items.insert(0, entry.model_dump())
        self._save(items[:self.MAX])
        return entry

    def list(self, conn_id: Optional[str] = None, limit: int = 100) -> list[HistoryEntry]:
        items = self._load_list()
        if conn_id:
            items = [r for r in items if r.get("conn_id") == conn_id]
        return [HistoryEntry(**r) for r in items[:limit]]

    def clear(self, conn_id: Optional[str] = None) -> int:
        items = self._load_list()
        if conn_id is None:
            self._save([])
            return len(items)
        kept = [r for r in items if r.get("conn_id") != conn_id]
        self._save(kept)
        return len(items) - len(kept)


class AlertStore(_JsonStore):
    filename = "alerts.json"

    def list(self) -> list[AlertRule]:
        items = sorted(self._load().values(), key=lambda r: r.get("created_at", ""), reverse=True)
        return [AlertRule(**r) for r in items]

    def get(self, alert_id: str) -> Optional[AlertRule]:
        r = self._load().get(alert_id)
        return AlertRule(**r) if r else None

    def save(self, rule: AlertRule) -> AlertRule:
        if not rule.id:
            rule.id = str(uuid.uuid4())
        if not rule.created_at:
            rule.created_at = datetime.now(timezone.utc).isoformat()
        items = self._load()
        items[rule.id] = rule.model_dump()
        self._save(items)
        return rule

    def delete(self, alert_id: str) -> bool:
        items = self._load()
        if alert_id not in items:
            return False
        del items[alert_id]
        self._save(items)
        return True


connection_store = ConnectionStore()
mapping_store = MappingStore()
project_store = ProjectStore()
snippet_store = SnippetStore()
history_store = HistoryStore()
alert_store = AlertStore()
