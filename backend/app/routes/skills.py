"""Skill-gap analysis endpoints (Phase 11)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from flask import Blueprint, g, jsonify, request
from pydantic import BaseModel, ConfigDict, ValidationError
from typing import Literal

from ..auth.decorators import require_auth, require_role
from ..services.audit import log
from ..services.data import FilterError, fetch_students, latest_by_student, parse_filters
from ..services.settings_service import get_settings
from ..services.skill_rules import AXES, analyze
from ..utils.csv_utils import csv_response
from ..utils.errors import error_response

skills_bp = Blueprint("skills", __name__, url_prefix="/api/skills")
RemediationStatus = Literal["enrolled", "action_required", "awaiting_retest", "benchmark_met"]
SEVERITIES = {"critical", "needs_refinement", "meets", "unassessed"}


class RemediationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: RemediationStatus | None


def _student(student_id: str) -> dict[str, Any] | None:
    try:
        UUID(student_id)
    except ValueError:
        return None
    rows = g.db.table("students").select("*").eq("id", student_id).limit(1).execute().data or []
    return rows[0] if rows else None


def _cgpa(student) -> float | None:
    try:
        return None if student.get("cgpa") is None else float(student["cgpa"])
    except (TypeError, ValueError):
        return None


@skills_bp.get("/gap/<student_id>")
@require_auth
def student_gap(student_id: str):
    student = _student(student_id)
    if student is None:
        return error_response(404, "not_found", "Student not found")
    assessments = g.db.table("skill_assessments").select("*").eq("student_id", student_id).order(
        "assessed_at", desc=True).limit(5).execute().data or []
    if not assessments:
        return error_response(404, "no_assessment",
                              f"{student['full_name']} has no skill assessment yet. Add one from Student "
                              "Management (View → Skill assessment) or POST /api/students/<id>/skills.")
    result = analyze(assessments[0], _cgpa(student), get_settings())
    return jsonify({
        "student": {k: student.get(k) for k in ("id", "usn", "full_name", "department", "batch_year", "cgpa",
                                                "placement_status", "remediation_status")},
        "assessment": assessments[0],
        "history": assessments,
        **result,
    })


def _cohort_rows() -> list[dict[str, Any]]:
    filters = parse_filters(request.args)
    search = (request.args.get("search") or "").strip()
    if search:
        filters["search"] = search
    severity = (request.args.get("severity") or "").strip()
    if severity and severity not in SEVERITIES:
        raise FilterError("severity must be critical, needs_refinement, meets or unassessed")
    remediation = (request.args.get("remediation_status") or "").strip()
    settings = get_settings()
    students = fetch_students(filters)
    latest = latest_by_student("skill_assessments", [s["id"] for s in students], "*", "assessed_at")
    rows = []
    for s in students:
        assessment = latest.get(s["id"])
        row = {k: s.get(k) for k in ("id", "usn", "full_name", "department", "batch_year", "cgpa",
                                     "aptitude_score", "technical_score", "communication_score",
                                     "remediation_status", "placement_status")}
        if assessment:
            result = analyze(assessment, _cgpa(s), settings)
            row.update({a: assessment.get(a) for a in AXES})
            row["overall_competency"] = result["overall_competency"]
            crit = result["critical_domain"]
            row["primary_deficit"] = crit["axis"] if crit else None
            row["primary_deficit_label"] = crit["label"] if crit else None
            row["primary_deficit_gap"] = crit["gap"] if crit else None
            row["severity"] = "critical" if result["critical_count"] else (
                "needs_refinement" if result["deficit_count"] else "meets")
            row["eligible_tier"] = result["eligible_tier"]["key"]
        else:
            row.update({"primary_deficit": None, "severity": "unassessed", "overall_competency": None})
        rows.append(row)
    if severity:
        rows = [r for r in rows if r["severity"] == severity]
    if remediation:
        rows = [r for r in rows if (r.get("remediation_status") or "none") == remediation]
    order = {"critical": 0, "needs_refinement": 1, "unassessed": 2, "meets": 3}
    rows.sort(key=lambda r: (order[r["severity"]], -(r.get("primary_deficit_gap") or 0), r["usn"]))
    return rows


@skills_bp.get("/cohort")
@require_auth
def cohort():
    try:
        rows = _cohort_rows()
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 10))))
    except (FilterError, ValueError) as exc:
        return error_response(400, "validation_error", str(exc))
    summary = {k: sum(r["severity"] == k for r in rows) for k in ("critical", "needs_refinement", "meets", "unassessed")}
    start = (page - 1) * per_page
    return jsonify({"items": rows[start:start + per_page], "total": len(rows), "page": page,
                    "per_page": per_page, "summary": summary})


@skills_bp.get("/cohort/export.csv")
@require_auth
def cohort_export():
    try:
        rows = _cohort_rows()
    except FilterError as exc:
        return error_response(400, "validation_error", str(exc))
    log("export", "skill_cohort", None, {"row_count": len(rows)})
    header = ["usn", "full_name", "department", "batch_year", "cgpa", *AXES, "overall_competency",
              "severity", "primary_deficit", "primary_deficit_gap", "eligible_tier", "remediation_status"]
    return csv_response(header, ([r.get(h) for h in header] for r in rows), "skill_cohort")


@skills_bp.get("/gap/<student_id>/export.csv")
@require_auth
def student_gap_export(student_id: str):
    student = _student(student_id)
    if student is None:
        return error_response(404, "not_found", "Student not found")
    assessments = g.db.table("skill_assessments").select("*").eq("student_id", student_id).order(
        "assessed_at", desc=True).limit(1).execute().data or []
    if not assessments:
        return error_response(404, "no_assessment", "No skill assessment recorded for this student")
    result = analyze(assessments[0], _cgpa(student), get_settings())
    rows = [["student", "usn", student["usn"], ""], ["student", "name", student["full_name"], ""],
            ["student", "cgpa", student.get("cgpa"), ""],
            ["summary", "overall_competency", result["overall_competency"], ""],
            ["summary", "eligible_tier", result["eligible_tier"]["label"], result["eligible_tier"]["reason"]]]
    for a in result["axes"]:
        rows.append(["axis", a["axis"], f"{a['score']:g}/{a['target']:g} ({a['severity']})", a["trigger"]])
    for item in result["roadmap"]:
        rows.append([f"roadmap P{item['priority']}", item["code"], item["title"], item["diagnostic_trigger"]])
    log("export", "skill_gap_report", student_id, {"usn": student["usn"]})
    return csv_response(["section", "item", "value", "detail"], rows, f"skill_gap_{student['usn']}")


@skills_bp.patch("/remediation/<student_id>")
@require_role("super_admin", "placement_officer", "faculty_mentor")
def update_remediation(student_id: str):
    student = _student(student_id)
    if student is None:
        return error_response(404, "not_found", "Student not found")
    try:
        body = RemediationUpdate.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return error_response(400, "validation_error", "Invalid remediation status", exc.errors(include_context=False))
    g.db.table("students").update({"remediation_status": body.status}).eq("id", student_id).execute()
    log("update", "students", student_id, {"remediation_status": body.status,
                                          "previous": student.get("remediation_status")})
    return jsonify({"id": student_id, "remediation_status": body.status})


@skills_bp.post("/cohort/sync")
@require_role("super_admin", "placement_officer", "faculty_mentor")
def cohort_sync():
    """Recompute remediation flags for the filtered cohort from current assessments.

    Students already 'enrolled' or 'awaiting_retest' keep their status (a human set it);
    others become 'action_required' (any gap) or 'benchmark_met' (no gaps).
    """
    try:
        rows = _cohort_rows()
    except FilterError as exc:
        return error_response(400, "validation_error", str(exc))
    changed = {"action_required": 0, "benchmark_met": 0, "kept": 0, "unassessed": 0}
    for r in rows:
        if r["severity"] == "unassessed":
            changed["unassessed"] += 1
            continue
        if r.get("remediation_status") in {"enrolled", "awaiting_retest"}:
            changed["kept"] += 1
            continue
        new_status = "benchmark_met" if r["severity"] == "meets" else "action_required"
        if r.get("remediation_status") != new_status:
            g.db.table("students").update({"remediation_status": new_status}).eq("id", r["id"]).execute()
        changed[new_status] += 1
    log("sync", "skill_cohort", None, {"evaluated": len(rows), **changed})
    return jsonify({"evaluated": len(rows), **changed})
