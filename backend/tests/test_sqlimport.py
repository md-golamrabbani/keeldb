"""SQL-dump import: parse mysqldump/pg_dump into SQLite, preserving PK & FK."""
import sqlite3

import pytest

from app.sqlimport.loader import load_sql_dump
from app.models import SavedConnection
from app.connectors import connector_for


def test_mysqldump_roundtrip(tmp_path):
    dump = r"""
    DROP TABLE IF EXISTS `t`;
    CREATE TABLE `t` (`id` int(11) NOT NULL, `nm` varchar(255), `note` text,
      PRIMARY KEY (`id`), KEY `k` (`nm`)) ENGINE=InnoDB;
    INSERT INTO `t` VALUES (1,'A O\'Brien','likes; semis'),(2,'B',NULL);
    """
    p = str(tmp_path / "m.db")
    res = load_sql_dump(dump, p)
    assert res.tables == {"t": 2}
    conn = sqlite3.connect(p)
    rows = conn.execute("SELECT id,nm,note FROM t ORDER BY id").fetchall()
    conn.close()
    assert rows[0] == (1, "A O'Brien", "likes; semis")
    assert rows[1][2] is None


def test_pgdump_integer_affinity(tmp_path):
    pg = """
    CREATE TABLE public.u (id integer NOT NULL, name varchar(64), active boolean);
    INSERT INTO public.u VALUES (1, 'admin', true);
    """
    p = str(tmp_path / "p.db")
    res = load_sql_dump(pg, p)
    assert res.tables == {"u": 1}
    conn = sqlite3.connect(p)
    row = conn.execute("SELECT id, name FROM u").fetchone()
    conn.close()
    assert row[0] == 1 and row[1] == "admin"  # integer affinity kept


def test_pk_and_fk_preserved(tmp_path):
    dump = """
    CREATE TABLE dept (id int PRIMARY KEY, name varchar(40));
    CREATE TABLE emp (id int PRIMARY KEY, dept_id int REFERENCES dept(id));
    CREATE TABLE audit (id int PRIMARY KEY, emp_id int, FOREIGN KEY (emp_id) REFERENCES emp(id));
    INSERT INTO dept VALUES (1,'Eng');
    INSERT INTO emp VALUES (1,1);
    """
    p = str(tmp_path / "fk.db")
    res = load_sql_dump(dump, p)
    prof = SavedConnection(id="x", name="d", flavor="sqlfile", database="main", sqlite_path=p, table_count=res.table_count)
    c = connector_for(prof)
    try:
        emp_cols = {col.name: col for col in c.list_columns("main", "emp")}
        assert emp_cols["id"].is_pk
        assert emp_cols["dept_id"].is_fk and "dept" in emp_cols["dept_id"].fk_target
    finally:
        c.dispose()


def test_insert_only_dump(tmp_path):
    p = str(tmp_path / "i.db")
    res = load_sql_dump("INSERT INTO orphan (a, b) VALUES (1,'x'),(2,'y');", p)
    assert res.tables == {"orphan": 2}


def test_empty_dump_raises(tmp_path):
    with pytest.raises(ValueError):
        load_sql_dump("SET names utf8; -- nothing here", str(tmp_path / "e.db"))
