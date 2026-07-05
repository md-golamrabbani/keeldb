from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import admin
from ..connectors import connector_for
from ..dbops import clean_error as admin_clean
from ..store import connection_store

router = APIRouter(prefix="/db", tags=["admin"])


def _connector(conn_id: str):
    record = connection_store.get(conn_id)
    if not record:
        raise HTTPException(404, "connection not found")
    return connector_for(record)


def _run(conn_id: str, fn, *args):
    c = _connector(conn_id)
    try:
        return fn(c, *args)
    except ValueError as exc:
        raise HTTPException(422, admin_clean(exc))
    except Exception as exc:
        raise HTTPException(400, admin_clean(exc))
    finally:
        c.dispose()


class SchemaTable(BaseModel):
    schema_name: str = ""
    table: str


class SchemaOnly(BaseModel):
    schema_name: str = ""


class ColumnDef(BaseModel):
    name: str
    type: str = "TEXT"
    nullable: bool = True
    pk: bool = False


class CreateTableReq(BaseModel):
    schema_name: str = ""
    name: str
    columns: list[ColumnDef]


class RenameTableReq(BaseModel):
    schema_name: str = ""
    table: str
    new_name: str


class AddColumnReq(BaseModel):
    schema_name: str = ""
    table: str
    name: str
    type: str = "TEXT"
    nullable: bool = True
    default: Optional[str] = None


class RenameColumnReq(BaseModel):
    schema_name: str = ""
    table: str
    name: str
    new_name: str


class DropColumnReq(BaseModel):
    schema_name: str = ""
    table: str
    name: str


class ModifyColumnReq(BaseModel):
    schema_name: str = ""
    table: str
    name: str
    new_type: str
    nullable: Optional[bool] = None


class DbNameReq(BaseModel):
    name: str


class DbRenameReq(BaseModel):
    name: str
    new_name: str


# -- DDL / ERD -------------------------------------------------------------
@router.post("/{conn_id}/ddl/table")
def table_ddl(conn_id: str, req: SchemaTable):
    return _run(conn_id, admin.table_ddl, req.schema_name, req.table)


@router.post("/{conn_id}/ddl/schema-graph")
def schema_graph(conn_id: str, req: SchemaOnly):
    return _run(conn_id, admin.schema_graph, req.schema_name)


# -- table ops -------------------------------------------------------------
@router.post("/{conn_id}/table/create")
def create_table(conn_id: str, req: CreateTableReq):
    return _run(conn_id, admin.create_table, req.schema_name, req.name, [c.model_dump() for c in req.columns])


@router.post("/{conn_id}/table/drop")
def drop_table(conn_id: str, req: SchemaTable):
    return _run(conn_id, admin.drop_table, req.schema_name, req.table)


@router.post("/{conn_id}/table/truncate")
def truncate_table(conn_id: str, req: SchemaTable):
    return _run(conn_id, admin.truncate_table, req.schema_name, req.table)


@router.post("/{conn_id}/table/rename")
def rename_table(conn_id: str, req: RenameTableReq):
    return _run(conn_id, admin.rename_table, req.schema_name, req.table, req.new_name)


# -- column ops ------------------------------------------------------------
@router.post("/{conn_id}/column/add")
def add_column(conn_id: str, req: AddColumnReq):
    return _run(conn_id, admin.add_column, req.schema_name, req.table, req.name, req.type, req.nullable, req.default)


@router.post("/{conn_id}/column/rename")
def rename_column(conn_id: str, req: RenameColumnReq):
    return _run(conn_id, admin.rename_column, req.schema_name, req.table, req.name, req.new_name)


@router.post("/{conn_id}/column/drop")
def drop_column(conn_id: str, req: DropColumnReq):
    return _run(conn_id, admin.drop_column, req.schema_name, req.table, req.name)


@router.post("/{conn_id}/column/modify")
def modify_column(conn_id: str, req: ModifyColumnReq):
    return _run(conn_id, admin.modify_column, req.schema_name, req.table, req.name, req.new_type, req.nullable)


# -- database ops ----------------------------------------------------------
@router.post("/{conn_id}/database/create")
def create_database(conn_id: str, req: DbNameReq):
    return _run(conn_id, admin.create_database, req.name)


@router.post("/{conn_id}/database/drop")
def drop_database(conn_id: str, req: DbNameReq):
    return _run(conn_id, admin.drop_database, req.name)


@router.post("/{conn_id}/database/rename")
def rename_database(conn_id: str, req: DbRenameReq):
    return _run(conn_id, admin.rename_database, req.name, req.new_name)


# -- inspection ------------------------------------------------------------
@router.post("/{conn_id}/triggers")
def triggers(conn_id: str, req: SchemaOnly):
    return _run(conn_id, admin.list_triggers, req.schema_name)


@router.post("/{conn_id}/privileges")
def privileges(conn_id: str, req: SchemaOnly):
    return _run(conn_id, admin.list_privileges, req.schema_name)
