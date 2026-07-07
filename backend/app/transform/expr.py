"""Safe, sandboxed per-column transform expressions. No arbitrary eval.

An expression is parsed with `ast.parse` and evaluated by walking the tree,
allowing ONLY: calls to whitelisted functions, the names `value` (the current
source cell) and `row` (the full source row, subscript with a constant string),
constants, dicts/lists/tuples, and string concatenation with `+`.

Examples (from the HRIS acceptance scenario):
    trim(value)
    split_part(row['employee_name'], ' ', -1)          # last name
    map({'yes': True, 'no': False}, lower(value))
    to_bool(value, 'yes', 'no')
    parse_date(value, '%d/%m/%Y')
    uuid5('people', row['employee_id'])                 # deterministic link key
    coalesce(value, 'N/A')
    concat(trim(row['city_1']), ', ', trim(row['country_1']))
"""
from __future__ import annotations

import ast
from datetime import datetime
from typing import Any, Callable

from .masking import MASK_FUNCTIONS
from .registry import FALSE_WORDS, TRUE_WORDS, _parse_dt
from .uuidgen import det_uuid


def _trim(v: Any) -> Any:
    return v.strip() if isinstance(v, str) else v


def _lower(v: Any) -> Any:
    return v.lower() if isinstance(v, str) else v


def _upper(v: Any) -> Any:
    return v.upper() if isinstance(v, str) else v


def _split_part(v: Any, sep: str, index: int) -> Any:
    """1-based like Postgres split_part; negative counts from the end.
    split_part('Golam Rabbani', ' ', -1) -> 'Rabbani'."""
    if v is None:
        return None
    parts = str(v).split(sep)
    i = index - 1 if index > 0 else index
    try:
        return parts[i]
    except IndexError:
        return ""


def _split_before(v: Any, sep: str) -> Any:
    """Everything before the LAST separator — e.g. first name(s)."""
    if v is None:
        return None
    s = str(v)
    head, _, _ = s.rpartition(sep)
    return head if head else s


def _coalesce(*args: Any) -> Any:
    for a in args:
        if a is not None and a != "":
            return a
    return None


def _map(table: dict, v: Any, *default: Any) -> Any:
    if v in table:
        return table[v]
    if default:
        return default[0]
    raise ValueError(f"map: no entry for {v!r}")


def _to_bool(v: Any, true_word: str = "", false_word: str = "") -> Any:
    if v is None:
        return None
    s = str(v).strip().lower()
    if true_word and s == true_word.lower():
        return True
    if false_word and s == false_word.lower():
        return False
    if not true_word and s in TRUE_WORDS:
        return True
    if not false_word and s in FALSE_WORDS:
        return False
    raise ValueError(f"to_bool: unmapped value {v!r}")


def _parse_date(v: Any, fmt: str = "") -> Any:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return _parse_dt(v, fmt).date()


def _parse_timestamp(v: Any, fmt: str = "") -> Any:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return _parse_dt(v, fmt)


def _concat(*args: Any) -> str:
    return "".join("" if a is None else str(a) for a in args)


def _replace(v: Any, old: str, new: str) -> Any:
    return str(v).replace(old, new) if v is not None else None


def _substr(v: Any, start: int, length: int = -1) -> Any:
    if v is None:
        return None
    s = str(v)[start - 1:]
    return s if length < 0 else s[:length]


def _zfill(v: Any, width: int) -> Any:
    return str(v).zfill(width) if v is not None else None


def _nullif(v: Any, match: Any) -> Any:
    return None if v == match else v


FUNCTIONS: dict[str, Callable[..., Any]] = {
    "trim": _trim,
    "lower": _lower,
    "upper": _upper,
    "split_part": _split_part,
    "split_before": _split_before,
    "coalesce": _coalesce,
    "map": _map,
    "to_bool": _to_bool,
    "parse_date": _parse_date,
    "parse_timestamp": _parse_timestamp,
    "uuid5": det_uuid,
    "concat": _concat,
    "replace": _replace,
    "substr": _substr,
    "zfill": _zfill,
    "nullif": _nullif,
    # data masking / anonymization (deterministic — see transform/masking.py)
    **MASK_FUNCTIONS,
}

_ALLOWED_NODES = (
    ast.Expression,
    ast.Call,
    ast.Name,
    ast.Constant,
    ast.Dict,
    ast.List,
    ast.Tuple,
    ast.Subscript,
    ast.BinOp,
    ast.Add,
    ast.UnaryOp,
    ast.USub,
    ast.Load,
)


class ExprError(ValueError):
    pass


def _check(node: ast.AST) -> None:
    for child in ast.walk(node):
        if not isinstance(child, _ALLOWED_NODES):
            raise ExprError(f"disallowed syntax: {type(child).__name__}")
        if isinstance(child, ast.Call):
            if not isinstance(child.func, ast.Name) or child.func.id not in FUNCTIONS:
                raise ExprError("only whitelisted functions may be called")
            if child.keywords:
                raise ExprError("keyword arguments are not allowed")
        if isinstance(child, ast.Name) and child.id not in FUNCTIONS and child.id not in ("value", "row"):
            raise ExprError(f"unknown name: {child.id}")
        if isinstance(child, ast.Subscript):
            if not (isinstance(child.value, ast.Name) and child.value.id == "row"):
                raise ExprError("subscript is only allowed on row[...]")
            if not (isinstance(child.slice, ast.Constant) and isinstance(child.slice.value, str)):
                raise ExprError("row[...] key must be a string constant")
        if isinstance(child, ast.BinOp) and not isinstance(child.op, ast.Add):
            raise ExprError("only '+' is allowed")


def _eval(node: ast.AST, value: Any, row: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval(node.body, value, row)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id == "value":
            return value
        if node.id == "row":
            return row
        raise ExprError(f"bare function reference: {node.id}")
    if isinstance(node, ast.Subscript):
        key = node.slice.value  # type: ignore[attr-defined]
        if key not in row:
            raise ExprError(f"row has no column {key!r}")
        return row[key]
    if isinstance(node, ast.Call):
        fn = FUNCTIONS[node.func.id]  # type: ignore[attr-defined]
        args = [_eval(a, value, row) for a in node.args]
        return fn(*args)
    if isinstance(node, ast.Dict):
        return {
            _eval(k, value, row): _eval(v, value, row)
            for k, v in zip(node.keys, node.values)
            if k is not None
        }
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval(e, value, row) for e in node.elts]
    if isinstance(node, ast.BinOp):
        left, right = _eval(node.left, value, row), _eval(node.right, value, row)
        return ("" if left is None else str(left)) + ("" if right is None else str(right)) if isinstance(left, str) or isinstance(right, str) else left + right
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval(node.operand, value, row)
    raise ExprError(f"unsupported node: {type(node).__name__}")


def eval_expr(expr: str, value: Any, row: dict[str, Any]) -> Any:
    """Evaluate a transform expression against one cell + its row."""
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ExprError(f"syntax error in transform: {exc}") from exc
    _check(tree)
    return _eval(tree, value, row)


def validate_expr(expr: str) -> str:
    """Return '' if the expression is well-formed, else the error message."""
    try:
        tree = ast.parse(expr, mode="eval")
        _check(tree)
        return ""
    except (SyntaxError, ExprError) as exc:
        return str(exc)
