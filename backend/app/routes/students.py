"""Student CRUD, search, assessment, and CSV endpoints."""
from __future__ import annotations

import csv
import io
import math
from datetime import date
from typing import Any
from uuid import UUID

import pandas as pd
from flask import Blueprint, Response, g, jsonify, request, stream_with_context
from pydantic import ValidationError

from ..auth.decorators import require_auth, require_role
from ..schemas.students import SkillAssessmentIn, StudentCreate, StudentUpdate
from ..services.audit import log
from ..services.db import fetch_all
from ..utils.ratelimit import rate_limit

students_bp = Blueprint("students", __name__, url_prefix="/api/students")
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 5_000
BATCH_SIZE = 500
STUDENT_FIELDS = list(StudentCreate.model_fields)
CSV_FIELDS = STUDENT_FIELDS
SORT_FIELDS = {
    "usn", "full_name", "department", "batch_year", "cgpa", "placement_status",
    "aptitude_score", "technical_score", "communication_score", "created_at",
}
NON_NULL_UPDATE_FIELDS = {
    "usn", "full_name", "department", "batch_year", "internships", "projects",
    "certifications", "backlogs", "extracurricular", "placement_training", "placement_status",
}


def _error(status: int, code: str, message: str, details: Any = None):
    return jsonify({"error": {"code": code, "message": message, "details": details}}), status


def _is_duplicate(exc: Exception) -> bool:
    text = str(exc).lower()
    return "23505" in text or "duplicate key" in text or "unique constraint" in text


def _filtered_students(query_args=None):
    args = query_args or request.args

    def build():
        return _build_student_query(args)

    return fetch_all(build)


def _build_student_query(args):
    query = g.db.table("students").select("*")
    search = (args.get("search") or "").strip()
    if search:
        escaped = search.replace(",", "")
        query = query.or_(f"usn.ilike.%{escaped}%,full_name.ilike.%{escaped}%")
    department = args.get("department")
    if department:
        query = query.eq("department", department.upper())
    batch_year = args.get("batch_year")
    if batch_year:
        query = query.eq("batch_year", int(batch_year))
    status = args.get("status")
    if status:
        query = query.eq("placement_status", status)
    cgpa_min = args.get("cgpa_min")
    cgpa_max = args.get("cgpa_max")
    if cgpa_min not in (None, ""):
        query = query.gte("cgpa", float(cgpa_min))
    if cgpa_max not in (None, ""):
        query = query.lte("cgpa", float(cgpa_max))
    return query.order("usn")


def _numeric_query_arg(name: str, minimum: float, maximum: float | None = None) -> float | None:
    raw = request.args.get(name)
    if raw in (None, ""):
        return None
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if not math.isfinite(value) or value < minimum or (maximum is not None and value > maximum):
        raise ValueError(f"{name} is outside the allowed range")
    return value


def _settings_thresholds() -> tuple[float, float]:
    rows = g.db.table("app_settings").select("key, value").in_(
        "key", ["technical_threshold", "aptitude_threshold"]
    ).execute().data or []
    values = {row["key"]: row["value"] for row in rows}
    return float(values.get("technical_threshold", 60)), float(values.get("aptitude_threshold", 65))


def _summary(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {status: sum(row.get("placement_status") == status for row in rows)
              for status in ("placed", "in_process", "not_placed")}
    technical_threshold, aptitude_threshold = _settings_thresholds()
    ids = [row.get("id") for row in rows if row.get("id")]
    assessments: dict[str, dict[str, Any]] = {}
    if ids:
        skill_rows = (
            g.db.table("skill_assessments")
            .select("student_id, dsa, system_design, core_cs, aptitude, communication, assessed_at")
            .in_("student_id", ids)
            .order("assessed_at", desc=True)
            .execute().data or []
        )
        for assessment in skill_rows:
            assessments.setdefault(assessment["student_id"], assessment)
    requires_support = 0
    for student in rows:
        assessment = assessments.get(student.get("id"), {})
        technical_scores = [student.get("technical_score"), assessment.get("dsa"),
                            assessment.get("system_design"), assessment.get("core_cs")]
        aptitude_scores = [student.get("aptitude_score"), assessment.get("aptitude")]
        below = any(value is not None and float(value) < technical_threshold for value in technical_scores)
        below = below or any(value is not None and float(value) < aptitude_threshold for value in aptitude_scores)
        if (student.get("cgpa") is not None and float(student["cgpa"]) < 7.0) or below:
            requires_support += 1
    return {
        "total": len(rows),
        "placed": counts["placed"],
        "in_process": counts["in_process"],
        "not_placed": counts["not_placed"],
        "requires_support": requires_support,
    }


def _validated_payload(model, payload: Any):
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        return exc


def _student_row(student_id: str) -> dict[str, Any] | None:
    try:
        UUID(student_id)
    except ValueError:
        return None
    result = g.db.table("students").select("*").eq("id", student_id).limit(1).execute()
    return (result.data or [None])[0]


@students_bp.get("")
@require_auth
def list_students():
    """Search and paginate students with a placement/support summary."""
    try:
        per_page = int(request.args.get("per_page", 10))
        page = int(request.args.get("page", 1))
        if not 1 <= per_page <= 500 or page < 1:
            raise ValueError("page must be >= 1 and per_page must be between 1 and 500")
        _numeric_query_arg("cgpa_min", 0, 10)
        _numeric_query_arg("cgpa_max", 0, 10)
        if request.args.get("department") and request.args["department"].upper() not in {"CSE", "IT", "AIDS", "ECE"}:
            raise ValueError("department must be one of CSE, IT, AIDS, ECE")
        if request.args.get("status") and request.args["status"] not in {"placed", "in_process", "not_placed", "opted_out"}:
            raise ValueError("status is not a valid placement status")
        if request.args.get("batch_year"):
            int(request.args["batch_year"])
        sort = request.args.get("sort", "cgpa")
        order = request.args.get("order", "desc").lower()
        if sort not in SORT_FIELDS or order not in {"asc", "desc"}:
            raise ValueError("Invalid sort or order")
        rows = _filtered_students()
        rows.sort(key=lambda row: (row.get(sort) is None, row.get(sort)), reverse=order == "desc")
        total = len(rows)
        start = (page - 1) * per_page
        items = rows[start:start + per_page]
        return jsonify({
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "summary": _summary(rows),
        })
    except (ValueError, TypeError) as exc:
        return _error(400, "validation_error", str(exc))


@students_bp.get("/<student_id>")
@require_auth
def get_student(student_id: str):
    student = _student_row(student_id)
    if student is None:
        return _error(404, "not_found", "Student not found")
    skills = g.db.table("skill_assessments").select("*").eq("student_id", student_id).order(
        "assessed_at", desc=True
    ).limit(1).execute().data or []
    predictions = g.db.table("predictions").select("*").eq("student_id", student_id).order(
        "created_at", desc=True
    ).limit(1).execute().data or []
    return jsonify({**student, "latest_skill_assessment": skills[0] if skills else None,
                    "latest_prediction": predictions[0] if predictions else None})


@students_bp.post("")
@require_role("super_admin", "placement_officer", "faculty_mentor")
def create_student():
    payload = request.get_json(silent=True)
    validated = _validated_payload(StudentCreate, payload)
    if isinstance(validated, ValidationError):
        return _error(400, "validation_error", "Request validation failed", validated.errors(include_context=False))
    data = validated.model_dump()
    data["created_by"] = None if g.user["user_id"] == "dev-bypass" else g.user["user_id"]
    try:
        inserted = g.db.table("students").insert(data).execute().data or []
    except Exception as exc:
        if _is_duplicate(exc):
            return _error(409, "duplicate_usn", "A student with this USN already exists")
        raise
    student = inserted[0] if inserted else data
    log("create", "students", student.get("id"), {"usn": data["usn"]})
    return jsonify(student), 201


@students_bp.put("/<student_id>")
@require_role("super_admin", "placement_officer", "faculty_mentor")
def update_student(student_id: str):
    if _student_row(student_id) is None:
        return _error(404, "not_found", "Student not found")
    validated = _validated_payload(StudentUpdate, request.get_json(silent=True))
    if isinstance(validated, ValidationError):
        return _error(400, "validation_error", "Request validation failed", validated.errors(include_context=False))
    changes = validated.model_dump(exclude_unset=True)
    if not changes:
        return _error(400, "validation_error", "At least one field is required")
    if any(key in NON_NULL_UPDATE_FIELDS and value is None for key, value in changes.items()):
        return _error(400, "validation_error", "Required fields cannot be null")
    try:
        response = g.db.table("students").update(changes).eq("id", student_id).execute()
    except Exception as exc:
        if _is_duplicate(exc):
            return _error(409, "duplicate_usn", "A student with this USN already exists")
        raise
    student = (response.data or [None])[0]
    log("update", "students", student_id, {"fields": sorted(changes)})
    return jsonify(student or {"id": student_id, **changes})


@students_bp.delete("/<student_id>")
@require_role("super_admin", "placement_officer")
def delete_student(student_id: str):
    if _student_row(student_id) is None:
        return _error(404, "not_found", "Student not found")
    g.db.table("students").delete().eq("id", student_id).execute()
    log("delete", "students", student_id)
    return "", 204


@students_bp.post("/<student_id>/skills")
@require_role("super_admin", "placement_officer", "faculty_mentor")
def add_skill_assessment(student_id: str):
    if _student_row(student_id) is None:
        return _error(404, "not_found", "Student not found")
    validated = _validated_payload(SkillAssessmentIn, request.get_json(silent=True))
    if isinstance(validated, ValidationError):
        return _error(400, "validation_error", "Request validation failed", validated.errors(include_context=False))
    data = validated.model_dump()
    data["student_id"] = student_id
    result = g.db.table("skill_assessments").insert(data).execute().data or []
    assessment = result[0] if result else data
    log("create", "skill_assessments", assessment.get("id"), {"student_id": student_id})
    return jsonify(assessment), 201


@students_bp.get("/template.csv")
@require_auth
def student_template():
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(CSV_FIELDS)
    writer.writerow(["1XX21CS001", "Example Student", "student@example.edu", "CSE", 2025,
                     85, 86, 8.2, 75, 78, 80, 1, 3, 2, 0, True, True, "in_process", "", ""])
    return Response(output.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="students_template.csv"'})


def _clean_csv_value(value: Any) -> str:
    text = "" if value is None else str(value)
    stripped = text.lstrip()
    if stripped.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


@students_bp.get("/export.csv")
@require_auth
def export_students():
    try:
        rows = _filtered_students()
    except (ValueError, TypeError) as exc:
        return _error(400, "validation_error", str(exc))
    log("export", "students", None, {"row_count": len(rows), "filters": request.args.to_dict()})

    def generate():
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(CSV_FIELDS)
        yield stream.getvalue()
        for row in rows:
            stream.seek(0)
            stream.truncate(0)
            writer.writerow([_clean_csv_value(row.get(field, "")) for field in CSV_FIELDS])
            yield stream.getvalue()

    filename = f"students_{date.today().isoformat()}.csv"
    return Response(stream_with_context(generate()), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _read_import_upload():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ValueError("A CSV file is required")
    raw = upload.stream.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("CSV exceeds the 5 MB upload limit")
    try:
        frame = pd.read_csv(io.BytesIO(raw), encoding="utf-8-sig", dtype=object, keep_default_na=False)
    except Exception as exc:
        raise ValueError("Could not parse CSV file") from exc
    if len(frame) > MAX_IMPORT_ROWS:
        raise ValueError("CSV exceeds the 5,000 row limit")
    frame.columns = [str(column).strip().lstrip("\ufeff") for column in frame.columns]
    frame = frame.apply(lambda series: series.map(lambda value: value.strip() if isinstance(value, str) else value))
    return frame


@students_bp.post("/import")
@require_role("super_admin", "placement_officer")
@rate_limit("RATE_LIMIT_IMPORT_PER_MIN")
def import_students():
    mode = request.args.get("mode", "upsert")
    dry_run = request.args.get("dry_run", "false").lower() in {"true", "1", "yes"}
    if mode not in {"upsert", "insert_only"}:
        return _error(400, "validation_error", "mode must be upsert or insert_only")
    try:
        frame = _read_import_upload()
    except ValueError as exc:
        return _error(400, "validation_error", str(exc))

    valid: list[dict[str, Any]] = []
    row_numbers: list[int] = []
    errors: list[dict[str, Any]] = []
    invalid_rows: set[int] = set()
    seen_usns: set[str] = set()
    for index, raw_row in frame.iterrows():
        row_number = int(index) + 2
        payload = {str(key).strip(): (value if value != "" else None) for key, value in raw_row.to_dict().items()}
        for boolean_field in ("extracurricular", "placement_training"):
            if boolean_field in payload and isinstance(payload[boolean_field], str):
                value = payload[boolean_field].strip().lower()
                if value in {"true", "yes", "y", "1"}:
                    payload[boolean_field] = True
                elif value in {"false", "no", "n", "0"}:
                    payload[boolean_field] = False
        result = _validated_payload(StudentCreate, payload)
        if isinstance(result, ValidationError):
            invalid_rows.add(row_number)
            for detail in result.errors():
                errors.append({"row": row_number, "field": str(detail["loc"][0]), "message": detail["msg"]})
            continue
        data = result.model_dump()
        if data["usn"] in seen_usns:
            invalid_rows.add(row_number)
            errors.append({"row": row_number, "field": "usn", "message": "Duplicate USN in uploaded file"})
            continue
        seen_usns.add(data["usn"])
        valid.append(data)
        row_numbers.append(row_number)

    preview = valid[:10]
    if dry_run:
        log("import_dry_run", "students", None, {"valid_count": len(valid), "error_count": len(errors)})
        return jsonify({"valid_count": len(valid), "error_count": len(errors), "errors": errors,
                        "preview": preview})

    inserted = updated = 0
    failed = len(invalid_rows)
    for offset in range(0, len(valid), BATCH_SIZE):
        batch = valid[offset:offset + BATCH_SIZE]
        batch_rows = row_numbers[offset:offset + BATCH_SIZE]
        try:
            existing_response = g.db.table("students").select("usn").in_(
                "usn", [student["usn"] for student in batch]
            ).execute()
            existing_usns = {row["usn"] for row in (existing_response.data or [])}
            if mode == "insert_only":
                insertable = []
                insertable_rows = []
                for student, row_num in zip(batch, batch_rows):
                    if student["usn"] in existing_usns:
                        errors.append({"row": row_num, "field": "usn", "message": "USN already exists"})
                        failed += 1
                        invalid_rows.add(row_num)
                    else:
                        insertable.append(student)
                        insertable_rows.append(row_num)
                batch, batch_rows = insertable, insertable_rows
                if batch:
                    g.db.table("students").insert(batch).execute()
                    inserted += len(batch)
            elif batch:
                g.db.table("students").upsert(batch, on_conflict="usn").execute()
                updated += sum(student["usn"] in existing_usns for student in batch)
                inserted += len(batch) - sum(student["usn"] in existing_usns for student in batch)
        except Exception as exc:
            # Recover row-level results after a database batch failure.
            for student, row_num in zip(batch, batch_rows):
                try:
                    if mode == "insert_only":
                        g.db.table("students").insert(student).execute()
                        inserted += 1
                    else:
                        was_present = bool(g.db.table("students").select("usn").eq("usn", student["usn"]).execute().data)
                        g.db.table("students").upsert(student, on_conflict="usn").execute()
                        updated += int(was_present)
                        inserted += int(not was_present)
                except Exception as row_exc:
                    failed += 1
                    invalid_rows.add(row_num)
                    message = "USN already exists" if _is_duplicate(row_exc) else "Database write failed"
                    errors.append({"row": row_num, "field": "usn" if _is_duplicate(row_exc) else "row", "message": message})

    log("import", "students", None, {"mode": mode, "inserted": inserted, "updated": updated,
                                      "failed": failed, "validation_errors": len(errors)})
    return jsonify({"inserted": inserted, "updated": updated, "failed": failed, "errors": errors})
