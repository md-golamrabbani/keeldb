from __future__ import annotations

from ..models import ENGINE_FOR_FLAVOR, SavedConnection
from .base import Connector
from .mysql import MySQLConnector
from .postgres import PostgresConnector
from .sqlfile import SQLFileConnector
from .sqlite import SQLiteConnector


def connector_for(profile: SavedConnection) -> Connector:
    engine = ENGINE_FOR_FLAVOR[profile.flavor]
    if engine == "mysql":
        return MySQLConnector(profile)
    if engine == "sqlfile":
        return SQLFileConnector(profile)
    if engine == "sqlite":
        return SQLiteConnector(profile)
    return PostgresConnector(profile)
