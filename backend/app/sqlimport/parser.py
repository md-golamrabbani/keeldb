"""Tolerant SQL-dump parser for mysqldump / pg_dump style files.

It is NOT a full SQL engine. It extracts just enough to reconstruct the data:
  - CREATE TABLE  -> table name + ordered column names + a coarse type affinity
  - INSERT INTO   -> table name + optional column list + value tuples

Everything else (SET, LOCK, CREATE INDEX, comments, COPY blocks…) is ignored.
Quotes (' " `), escaped quotes ('' and \\'), and semicolons inside strings are
handled so statement splitting is safe.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional


@dataclass
class ParsedColumn:
    name: str
    affinity: str  # sqlite affinity: INTEGER | REAL | NUMERIC | TEXT


@dataclass
class ParsedTable:
    name: str
    columns: list[ParsedColumn] = field(default_factory=list)


@dataclass
class ParsedInsert:
    table: str
    columns: Optional[list[str]]  # None => positional (matches CREATE TABLE order)
    rows: list[list[Any]]


def _affinity(sql_type: str) -> str:
    t = sql_type.lower()
    if re.search(r"\b(integer|int\d*|int|bigint|smallint|tinyint|mediumint|"
                 r"serial|bigserial|smallserial|bit)\b", t):
        return "INTEGER"
    if re.search(r"\b(float|double|real)\b", t):
        return "REAL"
    if re.search(r"\b(decimal|numeric|number|money)\b", t):
        return "NUMERIC"
    return "TEXT"


def split_statements(sql: str) -> Iterator[str]:
    """Yield top-level statements, respecting quotes/comments/dollar-quotes."""
    buf: list[str] = []
    i, n = 0, len(sql)
    quote: Optional[str] = None  # active ' " or `
    dollar_tag: Optional[str] = None  # active $tag$ ... $tag$ (pg)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(ch)
            i += 1
            continue

        if quote is not None:
            buf.append(ch)
            if ch == "\\" and quote in ("'", '"'):
                if nxt:
                    buf.append(nxt)
                    i += 2
                    continue
            if ch == quote:
                if nxt == quote:  # doubled quote escape
                    buf.append(nxt)
                    i += 2
                    continue
                quote = None
            i += 1
            continue

        # not inside a string
        if ch == "-" and nxt == "-":  # line comment
            j = sql.find("\n", i)
            i = n if j == -1 else j + 1
            continue
        if ch == "#":  # mysql line comment
            j = sql.find("\n", i)
            i = n if j == -1 else j + 1
            continue
        if ch == "/" and nxt == "*":  # block comment
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        m = re.match(r"\$[A-Za-z0-9_]*\$", sql[i:])  # dollar quote open (pg)
        if m:
            dollar_tag = m.group(0)
            buf.append(dollar_tag)
            i += len(dollar_tag)
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                yield stmt
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        yield tail


def _unquote_ident(ident: str) -> str:
    ident = ident.strip()
    if len(ident) >= 2 and ident[0] in "`\"[" and ident[-1] in "`\"]":
        return ident[1:-1]
    return ident


def _split_top_commas(s: str) -> list[str]:
    """Split on commas that are at paren-depth 0 and outside quotes."""
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: Optional[str] = None
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if quote is not None:
            buf.append(ch)
            if ch == "\\" and quote in ("'", '"') and i + 1 < n:
                buf.append(s[i + 1])
                i += 2
                continue
            if ch == quote:
                if i + 1 < n and s[i + 1] == quote:
                    buf.append(s[i + 1])
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
        elif ch in "([":
            depth += 1
            buf.append(ch)
        elif ch in ")]":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    if buf:
        parts.append("".join(buf).strip())
    return parts


_CONSTRAINT_KW = re.compile(
    r"^\s*(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL)\b",
    re.IGNORECASE,
)


def parse_create_table(stmt: str) -> Optional[ParsedTable]:
    m = re.match(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s*\((.*)\)\s*[^)]*$",
        stmt,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return None
    raw_name = m.group(1).strip()
    # strip schema qualifier: schema.table -> table
    name = _unquote_ident(raw_name.split(".")[-1])
    body = m.group(2)
    cols: list[ParsedColumn] = []
    for piece in _split_top_commas(body):
        if not piece or _CONSTRAINT_KW.match(piece):
            continue
        cm = re.match(r"\s*([`\"\[]?[\w$]+[`\"\]]?)\s+(.*)", piece, re.DOTALL)
        if not cm:
            continue
        col_name = _unquote_ident(cm.group(1))
        cols.append(ParsedColumn(name=col_name, affinity=_affinity(cm.group(2))))
    if not cols:
        return None
    return ParsedTable(name=name, columns=cols)


def _parse_value(tok: str) -> Any:
    t = tok.strip()
    if t == "":
        return None
    up = t.upper()
    if up == "NULL":
        return None
    if up in ("TRUE", "FALSE"):
        return 1 if up == "TRUE" else 0
    if t[0] in ("'", '"'):
        q = t[0]
        inner = t[1:-1] if len(t) >= 2 and t[-1] == q else t[1:]
        inner = inner.replace(q + q, q)  # doubled-quote escape
        inner = re.sub(r"\\(.)", lambda mm: {
            "n": "\n", "t": "\t", "r": "\r", "0": "\x00", "\\": "\\", "'": "'", '"': '"',
        }.get(mm.group(1), mm.group(1)), inner)  # backslash escapes
        return inner
    # numeric literal
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        return t  # keywords / functions -> keep raw text


def _split_value_tuples(values_part: str) -> list[str]:
    """Given '(...),(...),(...)' return each '(...)' inner content."""
    tuples: list[str] = []
    depth = 0
    quote: Optional[str] = None
    buf: list[str] = []
    i, n = 0, len(values_part)
    while i < n:
        ch = values_part[i]
        if quote is not None:
            buf.append(ch)
            if ch == "\\" and i + 1 < n:
                buf.append(values_part[i + 1])
                i += 2
                continue
            if ch == quote:
                if i + 1 < n and values_part[i + 1] == quote:
                    buf.append(values_part[i + 1])
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
        elif ch == "(":
            if depth == 0:
                buf = []
            else:
                buf.append(ch)
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                tuples.append("".join(buf))
            else:
                buf.append(ch)
        elif depth > 0:
            buf.append(ch)
        i += 1
    return tuples


def parse_insert(stmt: str) -> Optional[ParsedInsert]:
    m = re.match(
        r"INSERT\s+(?:IGNORE\s+)?INTO\s+(.+?)\s*(\([^)]*\))?\s+VALUES\s*(.*)$",
        stmt,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return None
    name = _unquote_ident(m.group(1).strip().split(".")[-1])
    columns = None
    if m.group(2):
        columns = [_unquote_ident(c) for c in _split_top_commas(m.group(2)[1:-1])]
    rows: list[list[Any]] = []
    for tup in _split_value_tuples(m.group(3)):
        rows.append([_parse_value(v) for v in _split_top_commas(tup)])
    if not rows:
        return None
    return ParsedInsert(table=name, columns=columns, rows=rows)
