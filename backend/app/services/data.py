"""Shared read helpers over students, assessments and predictions."""
from __future__ import annotations

from typing import Any

from flask import g

from .db import fetch_all

DEPARTMENTS = ("CSE", "IT", "AIDS", "ECE")
STATUSES = ("placed", "in_process", "not_placed", "opted_out")
SKILL_AXES = ("dsa", "system_design", "core_cs", "aptitude", "communication")
MODEL_INPUT_FIELDS = (
    "tenth_pct", "twelfth_pct", "cgpa", "aptitude_score", "technical_score",
    "communication_score", "internships", "projects", "certifications", "backlogs",
    "extracurricular", "placement_training",
)


class FilterError(ValueError):
    pass


def parse_filters(args) -> dict[str, Any]:
    """Validate the common department/batch_year/status query filters."""
    filters: dict[str, Any] = {}
    department = (args.get("department") or "").strip().upper()
    if department:
        if department not in DEPARTMENTS:
            raise FilterError("department must be one of CSE, IT, AIDS, ECE")
        filters["department"] = department
    batch = (args.get("batch_year") or "").strip()
    if batch:
        try:
            filters["batch_year"] = int(batch)
        except ValueError as exc:
            raise FilterError("batch_year must be an integer") from exc
    status = (args.get("status") or "").strip()
    if status:
        if status not in STATUSES:
            raise FilterError("status is not a valid placement status")
        filters["status"] = status
    return filters


def fetch_students(filters: dict[str, Any] | None = None, db=None) -> list[dict[str, Any]]:
    client = db or g.db
    filters = filters or {}

    def factory():
        query = client.table("students").select("*")
        if filters.get("department"):
            query = query.eq("department", filters["department"])
        if filters.get("batch_year"):
            query = query.eq("batch_year", filters["batch_year"])
        if filters.get("status"):
            query = query.eq("placement_status", filters["status"])
        if filters.get("search"):
            term = str(filters["search"]).replace(",", " ").replace("%", "").strip()
            if term:
                query = query.or_(f"usn.ilike.%{term}%,full_name.ilike.%{term}%")
        return query.order("usn")

    return fetch_all(factory)


def latest_by_student(table: str, ids: list[str] | None = None, columns: str = "*",
                      order_col: str = "created_at", db=None) -> dict[str, dict[str, Any]]:
    """Return the most recent row per student_id from predictions/skill_assessments."""
    client = db or g.db
    latest: dict[str, dict[str, Any]] = {}
    id_list = list(ids) if ids is not None else None
    if id_list is not None and not id_list:
        return latest
    chunks = [id_list[i:i + 200] for i in range(0, len(id_list), 200)] if id_list else [None]
    for chunk in chunks:
        def factory(chunk=chunk):
            query = client.table(table).select(columns)
            if chunk is not None:
                query = query.in_("student_id", chunk)
            return query.order(order_col, desc=True)
        for row in fetch_all(factory):
            sid = row.get("student_id")
            if sid and sid not in latest:
                latest[sid] = row
    return latest


def student_features(student: dict[str, Any]) -> dict[str, Any]:
    return {field: student.get(field) for field in MODEL_INPUT_FIELDS if student.get(field) is not None}


def actor_id() -> str | None:
    user_id = g.user["user_id"]
    return None if user_id == "dev-bypass" else user_id


def as_float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None
