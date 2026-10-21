"""Local demo data store used when Supabase is not configured.

It mimics the subset of the supabase-py / postgrest query-builder API that the
routes use (select/eq/in_/or_/order/range/insert/upsert/update/delete/execute),
so every route runs unchanged against either backend. Data persists to a JSON
file. Role rules that RLS enforces in Supabase are enforced by the Flask role
decorators, which mirror the policies one-to-one.

This is for local demos and tests only; production uses Supabase Postgres.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SEED_SQL = ROOT / "database" / "seed.sql"

TABLES = [
    "admin_profiles", "students", "skill_assessments", "predictions", "ml_models",
    "app_settings", "audit_log", "report_exports", "local_users",
]
UUID_TABLES = {"students", "skill_assessments", "predictions", "ml_models", "report_exports"}
DEFAULT_SETTINGS = {
    "tier1_min_cgpa": 8.5,
    "technical_threshold": 60,
    "aptitude_threshold": 65,
    "at_risk_probability": 0.5,
    "skill_target": 75,
    "placement_target_rate": 0.85,
    "dream_lpa": 10,
    "super_dream_lpa": 20,
    "high_potential_lpa": 6,
}
STUDENT_DEFAULTS = {
    "internships": 0, "projects": 0, "certifications": 0, "backlogs": 0,
    "extracurricular": False, "placement_training": False,
    "placement_status": "in_process", "remediation_status": None,
}
UNIQUE_KEYS = {"students": ["usn"], "ml_models": ["version"], "app_settings": ["key"],
               "admin_profiles": ["user_id"], "local_users": ["email"]}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DuplicateKeyError(Exception):
    """Raised like Postgres error 23505."""


def _coerce(value: Any) -> Any:
    return value


def _compare_key(value: Any):
    if value is None:
        return (1, 0)
    if isinstance(value, bool):
        return (0, int(value))
    if isinstance(value, (int, float)):
        return (0, value)
    return (0, str(value))


class LocalQuery:
    def __init__(self, store: "LocalStore", table: str) -> None:
        self.store = store
        self.table = table
        self.action = "select"
        self.payload: Any = None
        self.filters: list[tuple[str, str, Any]] = []
        self.or_groups: list[list[tuple[str, str, Any]]] = []
        self.orders: list[tuple[str, bool]] = []
        self.limit_value: int | None = None
        self.range_value: tuple[int, int] | None = None
        self.count_mode: str | None = None
        self.on_conflict: str | None = None
        self.columns: list[str] | None = None

    # ── builder API ─────────────────────────────────────────────────────
    def select(self, columns: str = "*", count: str | None = None, **_kwargs):
        if self.action == "select":
            cols = [c.strip() for c in columns.split(",") if c.strip()]
            self.columns = None if "*" in cols or not cols else cols
        self.count_mode = count
        return self

    def _filter(self, key, op, value):
        self.filters.append((key, op, value))
        return self

    def eq(self, key, value): return self._filter(key, "eq", value)
    def neq(self, key, value): return self._filter(key, "neq", value)
    def gt(self, key, value): return self._filter(key, "gt", value)
    def gte(self, key, value): return self._filter(key, "gte", value)
    def lt(self, key, value): return self._filter(key, "lt", value)
    def lte(self, key, value): return self._filter(key, "lte", value)
    def in_(self, key, values): return self._filter(key, "in", list(values))
    def ilike(self, key, pattern): return self._filter(key, "ilike", pattern)
    def is_(self, key, value): return self._filter(key, "is", value)

    def or_(self, expression: str):
        group = []
        for part in expression.split(","):
            pieces = part.split(".", 2)
            if len(pieces) == 3:
                group.append((pieces[0], pieces[1], pieces[2]))
        self.or_groups.append(group)
        return self

    def order(self, key, desc: bool = False, **_kwargs):
        self.orders.append((key, desc))
        return self

    def limit(self, value: int):
        self.limit_value = int(value)
        return self

    def range(self, start: int, end: int):
        self.range_value = (int(start), int(end))
        return self

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict: str | None = None, **_kwargs):
        self.action, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    # ── evaluation ─────────────────────────────────────────────────────
    @staticmethod
    def _match_one(row: dict, key: str, op: str, value: Any) -> bool:
        current = row.get(key)
        if op == "eq":
            if isinstance(current, bool) or isinstance(value, bool):
                return str(current).lower() == str(value).lower()
            if isinstance(current, (int, float)) and not isinstance(current, bool):
                try:
                    return float(current) == float(value)
                except (TypeError, ValueError):
                    return False
            return str(current) == str(value) if current is not None else False
        if op == "neq":
            return str(current) != str(value)
        if op in {"gt", "gte", "lt", "lte"}:
            if current is None:
                return False
            try:
                a, b = float(current), float(value)
            except (TypeError, ValueError):
                a, b = str(current), str(value)
            return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
        if op == "in":
            return current in value or str(current) in [str(v) for v in value]
        if op == "ilike":
            regex = "^" + re.escape(str(value).lower()).replace("%", ".*").replace("_", ".") + "$"
            return current is not None and re.match(regex, str(current).lower()) is not None
        if op == "is":
            if value in (None, "null"):
                return current is None
            return str(current).lower() == str(value).lower()
        return False

    def _matches(self, row: dict) -> bool:
        if not all(self._match_one(row, k, op, v) for k, op, v in self.filters):
            return False
        for group in self.or_groups:
            if not any(self._match_one(row, k, op, v) for k, op, v in group):
                return False
        return True

    def execute(self):
        with self.store.lock:
            return self._execute()

    def _project(self, row: dict) -> dict:
        if not self.columns:
            return deepcopy(row)
        return {c: deepcopy(row.get(c)) for c in self.columns}

    def _execute(self):
        rows = self.store.data.setdefault(self.table, [])
        if self.action == "select":
            result = [row for row in rows if self._matches(row)]
            for key, desc in reversed(self.orders):
                result.sort(key=lambda r: _compare_key(r.get(key)), reverse=desc)
                if desc:  # nulls last for descending, like Postgres NULLS LAST option
                    result.sort(key=lambda r: r.get(key) is None)
            total = len(result)
            if self.range_value:
                start, end = self.range_value
                result = result[start:end + 1]
            if self.limit_value is not None:
                result = result[: self.limit_value]
            return SimpleNamespace(data=[self._project(r) for r in result],
                                   count=total if self.count_mode else None)

        if self.action in {"insert", "upsert"}:
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            returned = []
            conflict_cols = (self.on_conflict.split(",") if self.on_conflict
                             else UNIQUE_KEYS.get(self.table, []))
            for payload in payloads:
                record = deepcopy(payload)
                existing = None
                if conflict_cols:
                    existing = next((r for r in rows if all(
                        str(r.get(c)) == str(record.get(c)) for c in conflict_cols
                    ) and all(record.get(c) is not None for c in conflict_cols)), None)
                if existing is not None:
                    if self.action == "insert":
                        raise DuplicateKeyError(
                            f"duplicate key value violates unique constraint {self.table}_"
                            f"{conflict_cols[0]}_key (23505)")
                    existing.update(record)
                    if "updated_at" in existing:
                        existing["updated_at"] = now_iso()
                    returned.append(deepcopy(existing))
                    continue
                self.store.apply_defaults(self.table, record)
                rows.append(record)
                returned.append(deepcopy(record))
            self.store.save()
            return SimpleNamespace(data=returned, count=None)

        if self.action == "update":
            changed = []
            for row in rows:
                if self._matches(row):
                    if self.table == "students" and "usn" in self.payload:
                        clash = any(r is not row and r.get("usn") == self.payload["usn"] for r in rows)
                        if clash:
                            raise DuplicateKeyError("duplicate key students_usn_key (23505)")
                    row.update(deepcopy(self.payload))
                    if "updated_at" in row:
                        row["updated_at"] = now_iso()
                    changed.append(deepcopy(row))
            self.store.save()
            return SimpleNamespace(data=changed, count=None)

        if self.action == "delete":
            removed = [row for row in rows if self._matches(row)]
            removed_ids = {r.get("id") for r in removed}
            self.store.data[self.table] = [row for row in rows if not self._matches(row)]
            if self.table == "students" and removed_ids:
                # ON DELETE CASCADE / SET NULL semantics from schema.sql
                self.store.data["skill_assessments"] = [
                    r for r in self.store.data.get("skill_assessments", [])
                    if r.get("student_id") not in removed_ids]
                for prediction in self.store.data.get("predictions", []):
                    if prediction.get("student_id") in removed_ids:
                        prediction["student_id"] = None
            self.store.save()
            return SimpleNamespace(data=removed, count=None)
        return SimpleNamespace(data=[], count=None)


class LocalClient:
    """Drop-in for a supabase Client's ``table()`` access."""

    def __init__(self, store: "LocalStore") -> None:
        self.store = store

    def table(self, name: str) -> LocalQuery:
        return LocalQuery(self.store, name)


class LocalStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.lock = threading.RLock()
        self.data: dict[str, list[dict[str, Any]]] = {}
        self._seq = 0
        self.load()

    def load(self) -> None:
        with self.lock:
            if self.path.is_file():
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            else:
                self.data = {}
            for table in TABLES:
                self.data.setdefault(table, [])
            ids = [r.get("id", 0) for r in self.data["audit_log"]]
            self._seq = max([i for i in ids if isinstance(i, int)] or [0])
            if not self.data["app_settings"]:
                for key, value in DEFAULT_SETTINGS.items():
                    self.data["app_settings"].append(
                        {"key": key, "value": value, "updated_by": None, "updated_at": now_iso()})
            else:
                present = {r["key"] for r in self.data["app_settings"]}
                for key, value in DEFAULT_SETTINGS.items():
                    if key not in present:
                        self.data["app_settings"].append(
                            {"key": key, "value": value, "updated_by": None, "updated_at": now_iso()})
            self.save()

    def save(self) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1, default=str), encoding="utf-8")
            tmp.replace(self.path)

    def apply_defaults(self, table: str, record: dict) -> None:
        stamp = now_iso()
        if table in UUID_TABLES:
            record.setdefault("id", str(uuid.uuid4()))
        if table == "audit_log":
            self._seq += 1
            record["id"] = self._seq
            record.setdefault("meta", {})
        if table in {"students", "admin_profiles"}:
            record.setdefault("created_at", stamp)
            record.setdefault("updated_at", stamp)
        if table == "students":
            for key, value in STUDENT_DEFAULTS.items():
                record.setdefault(key, value)
        if table == "admin_profiles":
            record.setdefault("is_active", True)
            record.setdefault("role", "placement_officer")
        if table == "skill_assessments":
            record.setdefault("assessed_at", stamp)
        if table in {"predictions", "audit_log", "report_exports", "local_users"}:
            record.setdefault("created_at", stamp)
        if table == "ml_models":
            record.setdefault("trained_at", stamp)
            record.setdefault("is_active", False)
        if table == "app_settings":
            record.setdefault("updated_at", stamp)

    # ── seeding ────────────────────────────────────────────────────────
    def is_empty(self) -> bool:
        return not self.data["students"] and not self.data["local_users"]

    def seed(self, admin_email: str, admin_password: str) -> None:
        """Load the 40 demo students from database/seed.sql and a first super admin."""
        from werkzeug.security import generate_password_hash

        with self.lock:
            students, assessments = parse_seed_sql(SEED_SQL)
            client = LocalClient(self)
            if students:
                client.table("students").upsert(students, on_conflict="usn").execute()
            by_usn = {s["usn"]: s["id"] for s in self.data["students"]}
            for usn, scores in assessments.items():
                if usn in by_usn and not any(
                    a.get("student_id") == by_usn[usn] for a in self.data["skill_assessments"]
                ):
                    client.table("skill_assessments").insert(
                        {"student_id": by_usn[usn], **scores, "source": "demo_seed_v1"}).execute()
            if not any(u["email"] == admin_email for u in self.data["local_users"]):
                user_id = str(uuid.uuid4())
                client.table("local_users").insert({
                    "user_id": user_id, "email": admin_email,
                    "password_hash": generate_password_hash(admin_password),
                    "last_sign_in_at": None,
                }).execute()
                client.table("admin_profiles").insert({
                    "user_id": user_id, "full_name": "Local Super Admin", "email": admin_email,
                    "role": "super_admin", "department": None, "is_active": True,
                }).execute()
            self.save()


_VALUE_RE = re.compile(r"'(?:[^']|'')*'|NULL|true|false|-?\d+(?:\.\d+)?", re.IGNORECASE)


def _sql_value(token: str) -> Any:
    if token.upper() == "NULL":
        return None
    if token.lower() in {"true", "false"}:
        return token.lower() == "true"
    if token.startswith("'"):
        return token[1:-1].replace("''", "'")
    return float(token) if "." in token else int(token)


def parse_seed_sql(path: Path) -> tuple[list[dict], dict[str, dict]]:
    """Extract demo students and skill assessments from seed.sql."""
    if not path.is_file():
        return [], {}
    text = path.read_text(encoding="utf-8")
    student_cols = [
        "usn", "full_name", "email", "department", "batch_year", "tenth_pct", "twelfth_pct",
        "cgpa", "aptitude_score", "technical_score", "communication_score", "internships",
        "projects", "certifications", "backlogs", "extracurricular", "placement_training",
        "placement_status", "company", "package_lpa",
    ]
    students = []
    block = text.split("INSERT INTO public.students", 1)[-1].split("ON CONFLICT", 1)[0]
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("('"):
            continue
        values = [_sql_value(t) for t in _VALUE_RE.findall(line)]
        if len(values) == len(student_cols):
            students.append(dict(zip(student_cols, values)))
    assessments: dict[str, dict] = {}
    if "demo_assessments" in text:
        block = text.split("VALUES", 2)[-1].split(")\nINSERT", 1)[0]
        for match in re.finditer(r"\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)", block):
            usn, *scores = match.groups()
            assessments[usn] = dict(zip(
                ["dsa", "system_design", "core_cs", "aptitude", "communication"], map(int, scores)))
    return students, assessments


_stores: dict[str, LocalStore] = {}
_stores_lock = threading.Lock()


def get_store(path: str | Path) -> LocalStore:
    key = str(Path(path).resolve())
    with _stores_lock:
        if key not in _stores:
            _stores[key] = LocalStore(key)
        return _stores[key]
