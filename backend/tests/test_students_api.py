"""Student-management endpoint tests with a deterministic Supabase mock."""
from __future__ import annotations

import io
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.auth import decorators


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table_name = table
        self.action = "select"
        self.payload = None
        self.filters = []
        self.search = None
        self.limit_value = None
        self.sort = None
        self.range_value = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, "eq", value))
        return self

    def gte(self, key, value):
        self.filters.append((key, "gte", value))
        return self

    def lte(self, key, value):
        self.filters.append((key, "lte", value))
        return self

    def in_(self, key, values):
        self.filters.append((key, "in", values))
        return self

    def or_(self, expression):
        self.search = expression.lower().split("ilike.%", 1)[-1].split("%", 1)[0]
        return self

    def order(self, key, desc=False):
        self.sort = (key, desc)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def range(self, start, end):
        self.range_value = (start, end)
        return self

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.action, self.payload = "upsert", payload
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def _matches(self, row):
        for key, operator, value in self.filters:
            if operator == "eq" and str(row.get(key)) != str(value):
                return False
            if operator == "gte" and (row.get(key) is None or float(row[key]) < float(value)):
                return False
            if operator == "lte" and (row.get(key) is None or float(row[key]) > float(value)):
                return False
            if operator == "in" and row.get(key) not in value:
                return False
        if self.search:
            terms = self.search.split(".")
            needle = terms[-1]
            if not any(needle in str(row.get(field, "")).lower() for field in ("usn", "full_name")):
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.action == "select":
            result = [dict(row) for row in rows if self._matches(row)]
            if self.sort:
                key, descending = self.sort
                result.sort(key=lambda row: row.get(key), reverse=descending)
            if self.range_value is not None:
                result = result[self.range_value[0]: self.range_value[1] + 1]
            if self.limit_value is not None:
                result = result[: self.limit_value]
            return SimpleNamespace(data=result)
        if self.action in {"insert", "upsert"}:
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            returned = []
            for payload in payloads:
                record = dict(payload)
                if self.action == "insert" and self.table_name == "students" and any(
                    row.get("usn") == record.get("usn") for row in rows
                ):
                    raise RuntimeError("duplicate key value violates unique constraint (23505)")
                if self.action == "upsert" and self.table_name == "students":
                    existing = next((row for row in rows if row.get("usn") == record.get("usn")), None)
                    if existing:
                        existing.update(record)
                        returned.append(dict(existing))
                        continue
                record.setdefault("id", str(uuid4()))
                rows.append(record)
                returned.append(dict(record))
            return SimpleNamespace(data=returned)
        if self.action == "update":
            changed = []
            for row in rows:
                if self._matches(row):
                    row.update(self.payload)
                    changed.append(dict(row))
            return SimpleNamespace(data=changed)
        if self.action == "delete":
            removed = [row for row in rows if self._matches(row)]
            self.db.tables[self.table_name] = [row for row in rows if not self._matches(row)]
            return SimpleNamespace(data=removed)
        return SimpleNamespace(data=[])


class FakeDB:
    def __init__(self):
        self.tables = {
            "admin_profiles": [{"user_id": "admin-1", "email": "admin@example.edu",
                                "full_name": "Admin User", "role": "placement_officer",
                                "department": "CSE", "is_active": True}],
            "app_settings": [{"key": "technical_threshold", "value": 60},
                             {"key": "aptitude_threshold", "value": 65}],
            "students": [],
            "skill_assessments": [],
            "predictions": [],
            "audit_log": [],
        }

    def table(self, name):
        return FakeQuery(self, name)


@pytest.fixture

def api_client(client, monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(decorators, "verify_supabase_jwt", lambda _token: {
        "user_id": "admin-1", "email": "admin@example.edu"
    })
    monkeypatch.setattr(decorators, "get_user_client", lambda _token: db)
    return client, db


def valid_student(**overrides):
    student = {
        "usn": " 1xx21cs001 ", "full_name": "  Asha Rao  ",
        "email": "ASHA.RAO@example.edu", "department": "CSE", "batch_year": 2025,
        "tenth_pct": 88.5, "twelfth_pct": 90, "cgpa": 8.3,
        "aptitude_score": 78, "technical_score": 82, "communication_score": 80,
        "internships": 1, "projects": 3, "certifications": 2, "backlogs": 0,
        "extracurricular": True, "placement_training": True,
        "placement_status": "in_process", "company": None, "package_lpa": None,
    }
    student.update(overrides)
    return student


def auth_headers():
    return {"Authorization": "Bearer valid-token"}


def test_student_crud_happy_path(api_client):
    client, _db = api_client
    created = client.post("/api/students", json=valid_student(), headers=auth_headers())
    assert created.status_code == 201
    student = created.get_json()
    assert student["usn"] == "1XX21CS001"
    assert student["email"] == "asha.rao@example.edu"

    listing = client.get("/api/students?search=asha", headers=auth_headers())
    assert listing.status_code == 200
    assert listing.get_json()["total"] == 1
    assert listing.get_json()["items"][0]["id"] == student["id"]

    details = client.get(f"/api/students/{student['id']}", headers=auth_headers())
    assert details.status_code == 200
    assert details.get_json()["latest_skill_assessment"] is None

    updated = client.put(f"/api/students/{student['id']}", json={"cgpa": 9.1}, headers=auth_headers())
    assert updated.status_code == 200
    assert updated.get_json()["cgpa"] == 9.1

    skill = client.post(
        f"/api/students/{student['id']}/skills",
        json={"dsa": 80, "system_design": 70, "core_cs": 82, "aptitude": 78, "communication": 76},
        headers=auth_headers(),
    )
    assert skill.status_code == 201
    assert skill.get_json()["student_id"] == student["id"]

    deleted = client.delete(f"/api/students/{student['id']}", headers=auth_headers())
    assert deleted.status_code == 204


def test_duplicate_usn_returns_409(api_client):
    client, _ = api_client
    assert client.post("/api/students", json=valid_student(), headers=auth_headers()).status_code == 201
    duplicate = client.post("/api/students", json=valid_student(full_name="Another Student"), headers=auth_headers())
    assert duplicate.status_code == 409


def test_invalid_student_returns_400(api_client):
    client, _ = api_client
    response = client.post("/api/students", json=valid_student(cgpa=12), headers=auth_headers())
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "validation_error"


def test_csv_import_dry_run_reports_bad_row(api_client):
    client, _db = api_client
    csv_content = (
        "usn,full_name,email,department,batch_year,cgpa,extracurricular\n"
        "1XX21CS001,Asha Rao,asha@example.edu,CSE,2025,8.2,True\n"
        "1XX21CS002,Bad Student,bad@example.edu,CSE,2025,12,False\n"
        "1XX21IT003,Ravi Shah,ravi@example.edu,IT,2025,7.4,Yes\n"
    )
    response = client.post(
        "/api/students/import?dry_run=true",
        data={"file": (io.BytesIO(csv_content.encode()), "students.csv")},
        headers=auth_headers(),
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    result = response.get_json()
    assert result["valid_count"] == 2
    assert result["error_count"] == 1
    assert result["errors"][0]["row"] == 3
    assert result["errors"][0]["field"] == "cgpa"
    assert result["preview"][0]["extracurricular"] is True
    assert len(_db.tables["students"]) == 0


def test_export_csv_header_and_formula_escape(api_client):
    client, db = api_client
    db.tables["students"].append({**valid_student(full_name="=HYPERLINK(\"x\")"), "id": str(uuid4())})
    response = client.get("/api/students/export.csv", headers=auth_headers())
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert body.splitlines()[0].startswith("usn,full_name,email")
    assert "'=HYPERLINK" in body
    assert "attachment; filename=\"students_" in response.headers["Content-Disposition"]
    assert db.tables["audit_log"][-1]["action"] == "export"
