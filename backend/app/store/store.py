"""Local JSON persistence. Secrets (password, connection string, service-role
key) are Fernet-encrypted at rest with a machine-local key file (0600).
Passwords are never returned by the API and never logged."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

from ..models import ConnectionProfileIn, MappingProfile, SavedConnection

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


connection_store = ConnectionStore()
mapping_store = MappingStore()
