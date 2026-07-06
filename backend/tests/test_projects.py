"""Multi-table migration projects: FK ordering, store, run-all."""
import sqlalchemy as sa

from app import projects as pj
from app.models import ColumnMap, MappingProfile, MigrationProject, SavedConnection
from app.connectors import connector_for
from app.store import connection_store, mapping_store, project_store


def _mapping(name, src_id, tgt_id, src_table, tgt_table):
    return MappingProfile(
        name=name, source_conn_id=src_id, target_conn_id=tgt_id,
        source_schema="main", source_table=src_table, target_schema="main", target_table=tgt_table,
        column_maps=[ColumnMap(source_col="id", target_col="id", is_conflict_key=True),
                     ColumnMap(source_col="name", target_col="name")],
        output_mode="csv", batch_size=100,
    )


def test_order_mappings_by_fk(make_conn):
    # target schema: emp.dept_id -> dept.id, audit.emp_id -> emp.id
    tgt = make_conn("""
        CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER REFERENCES dept(id));
        CREATE TABLE audit (id INTEGER PRIMARY KEY, name TEXT, emp_id INTEGER REFERENCES emp(id));
    """)
    # give them in the WRONG order on purpose
    mappings = [_mapping("m_audit", "s", "t", "audit", "audit"),
                _mapping("m_emp", "s", "t", "emp", "emp"),
                _mapping("m_dept", "s", "t", "dept", "dept")]
    ordered = pj.order_mappings_by_fk(mappings, tgt, "main")
    tgt.dispose()
    names = [m.target_table for m in ordered]
    assert names.index("dept") < names.index("emp") < names.index("audit")


def test_project_store_crud():
    p = project_store.save(MigrationProject(name="proj", mapping_ids=["a", "b"]))
    assert p.id
    assert project_store.get(p.id).name == "proj"
    assert any(x.id == p.id for x in project_store.list())
    assert project_store.delete(p.id) and project_store.get(p.id) is None


def test_run_project_orders_and_reports(tmp_path):
    # one SQLite acts as source (with data) AND target (empty FK schema)
    src_path = str(tmp_path / "src.db")
    e = sa.create_engine(f"sqlite:///{src_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT)"))
        c.execute(sa.text("CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT)"))
        c.execute(sa.text("INSERT INTO dept VALUES (1,'Eng'),(2,'HR')"))
        c.execute(sa.text("INSERT INTO emp VALUES (1,'A'),(2,'B'),(3,'C')"))
    e.dispose()
    tgt_path = str(tmp_path / "tgt.db")
    e = sa.create_engine(f"sqlite:///{tgt_path}")
    with e.begin() as c:
        c.execute(sa.text("CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT)"))
        c.execute(sa.text("CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER REFERENCES dept(id))"))
    e.dispose()

    src = connection_store.add(SavedConnection(id="src-p", name="src", flavor="sqlfile", database="main", sqlite_path=src_path))
    tgt = connection_store.add(SavedConnection(id="tgt-p", name="tgt", flavor="sqlfile", database="main", sqlite_path=tgt_path))
    m_emp = mapping_store.save(_mapping("emp map", src.id, tgt.id, "emp", "emp"))
    m_dept = mapping_store.save(_mapping("dept map", src.id, tgt.id, "dept", "dept"))
    proj = project_store.save(MigrationProject(name="hris", mapping_ids=[m_emp.id, m_dept.id]))

    events = list(pj.run_project(proj))
    start = next(e for e in events if e["event"] == "project_start")
    assert start["order"] == ["dept", "emp"]  # FK-ordered: dept before emp despite input order
    done = next(e for e in events if e["event"] == "project_done")
    assert done["ok"] and done["totals"]["rows_written"] == 5  # 2 dept + 3 emp
    assert [t["table"] for t in done["tables"]] == ["dept", "emp"]

    # cleanup store
    connection_store.delete("src-p"); connection_store.delete("tgt-p")
    mapping_store.delete(m_emp.id); mapping_store.delete(m_dept.id); project_store.delete(proj.id)
