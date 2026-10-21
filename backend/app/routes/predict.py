"""Placement prediction endpoints (Phase 8)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import pandas as pd
from flask import Blueprint, g, jsonify, request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..auth.decorators import require_auth, require_role
from ..services.audit import log
from ..services.data import (
    MODEL_INPUT_FIELDS, actor_id, fetch_students, latest_by_student, student_features,
)
from ..services.db import fetch_all
from ..services.model_service import get_model, public_metadata
from ..services.settings_service import get_settings, num
from ..utils.csv_utils import csv_response
from ..utils.errors import error_response
from ..utils.ratelimit import rate_limit

predict_bp = Blueprint("predict", __name__, url_prefix="/api")

FEATURE_LABELS = {
    "tenth_pct": "10th marks", "twelfth_pct": "12th marks", "cgpa": "CGPA",
    "aptitude_score": "Aptitude score", "technical_score": "Technical score",
    "communication_score": "Communication / soft skills", "internships": "Internships",
    "projects": "Projects", "certifications": "Certifications / workshops",
    "backlogs": "Backlogs", "extracurricular": "Extracurricular activities",
    "placement_training": "Placement training",
}
GUIDANCE = {
    "tenth_pct": "school academics are on record and cannot change, so focus effort elsewhere",
    "twelfth_pct": "school academics are on record and cannot change, so focus effort elsewhere",
    "cgpa": "protect and raise the CGPA in remaining semesters",
    "aptitude_score": "schedule timed quantitative and logical aptitude practice",
    "technical_score": "strengthen coding and core CS through mock technical rounds",
    "communication_score": "practise group discussions and mock HR interviews",
    "internships": "pursue an internship or industry project before drives begin",
    "projects": "build and document one more substantial project",
    "certifications": "complete a relevant workshop or certification",
    "backlogs": "clear outstanding backlogs, which many recruiters screen on",
    "extracurricular": "take part in a club, event or volunteering role",
    "placement_training": "enrol in the institution's placement training programme",
}


class FeatureInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenth_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    twelfth_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    cgpa: float | None = Field(default=None, ge=0, le=10, allow_inf_nan=False)
    aptitude_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    technical_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    communication_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    internships: int | None = Field(default=None, ge=0, le=20)
    projects: int | None = Field(default=None, ge=0, le=100)
    certifications: int | None = Field(default=None, ge=0, le=100)
    backlogs: int | None = Field(default=None, ge=0, le=20)
    extracurricular: bool | None = None
    placement_training: bool | None = None


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: str | None = None
    features: FeatureInput | None = None
    save: bool = False

    @model_validator(mode="after")
    def one_source(self):
        if not self.student_id and self.features is None:
            raise ValueError("Provide student_id or features")
        if self.student_id:
            UUID(self.student_id)
        return self


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department: str | None = None
    batch_year: int | None = Field(default=None, ge=1990, le=2100)
    only_unpredicted: bool = False


def _model_or_503():
    model = get_model()
    if model is None:
        return None, error_response(503, "model_unavailable",
                                    "No trained model is loaded. Run `python -m ml.train` in backend/.")
    return model, None


def _confidence(probability: float) -> str:
    distance = abs(probability - 0.5)
    return "high" if distance > 0.3 else "medium" if distance > 0.15 else "low"


def _advisory(contributions: list[dict[str, Any]], label: str) -> dict[str, Any]:
    positives = [c for c in contributions if c["impact"] > 0][:2]
    negatives = [c for c in contributions if c["impact"] < 0][:2]
    strengths = [FEATURE_LABELS.get(c["feature"], c["feature"]) for c in positives]
    lines = []
    if strengths:
        lines.append(f"Strongest supporting factors: {', '.join(strengths)}.")
    for c in negatives:
        lines.append(f"{FEATURE_LABELS.get(c['feature'], c['feature'])} is lowering the estimate — "
                     f"{GUIDANCE.get(c['feature'], 'review this area')}.")
    if not negatives:
        lines.append("No single input is pulling the estimate down noticeably; keep current preparation steady.")
    summary = ("Profile resembles historically placed candidates." if label == "placed"
               else "Profile resembles candidates who historically needed additional support.")
    return {"summary": summary, "points": lines,
            "positive_drivers": [c["feature"] for c in positives],
            "negative_drivers": [c["feature"] for c in negatives]}


def _percentile(probability: float, batch_year: int | None, exclude_id: str | None) -> float | None:
    filters = {"batch_year": batch_year} if batch_year else {}
    students = fetch_students(filters)
    ids = [s["id"] for s in students if s.get("id") != exclude_id]
    latest = latest_by_student("predictions", ids, "student_id, probability, created_at")
    peers = [float(p["probability"]) for p in latest.values() if p.get("probability") is not None]
    if not peers:
        return None
    below = sum(1 for p in peers if p < probability)
    return round(100 * below / len(peers), 1)


@predict_bp.get("/model")
@require_auth
def model_info():
    model = get_model()
    settings = get_settings()
    if model is None:
        return jsonify({"loaded": False, "threshold": num(settings, "at_risk_probability")})
    return jsonify({"loaded": True, **public_metadata(model),
                    "threshold": num(settings, "at_risk_probability"),
                    "leakage_guard": not set(model.features) & {"placement_status", "company", "package_lpa"}})


@predict_bp.post("/predict")
@require_auth
@rate_limit("RATE_LIMIT_PREDICT_PER_MIN")
def predict():
    model, failure = _model_or_503()
    if failure:
        return failure
    try:
        body = PredictRequest.model_validate(request.get_json(silent=True) or {})
    except (ValidationError, ValueError) as exc:
        details = exc.errors(include_context=False) if isinstance(exc, ValidationError) else None
        return error_response(400, "validation_error", "Invalid prediction request", details)

    student = None
    if body.student_id:
        rows = g.db.table("students").select("*").eq("id", body.student_id).limit(1).execute().data or []
        if not rows:
            return error_response(404, "not_found", "Student not found")
        student = rows[0]
        features = student_features(student)
        if body.features is not None:  # what-if overrides on top of the registry record
            features.update(body.features.model_dump(exclude_none=True))
    else:
        features = body.features.model_dump(exclude_none=True)

    try:
        result = model.predict_one(features)
    except ValueError as exc:
        return error_response(400, "validation_error", str(exc))

    threshold = num(get_settings(), "at_risk_probability")
    probability = result["probability"]
    label = "placed" if probability >= threshold else "not_placed"
    contributions = result["contributions"]
    response = {
        "probability": probability,
        "label": label,
        "threshold": threshold,
        "confidence": _confidence(probability),
        "contributions": contributions,
        "unused_by_model": model.unused_by_model,
        "advisory": _advisory(contributions, label),
        "percentile": _percentile(probability, student.get("batch_year") if student else None,
                                  student.get("id") if student else None),
        "model_version": model.metadata.get("version"),
        "features": features,
        "student": {k: student.get(k) for k in ("id", "usn", "full_name", "department", "batch_year")}
        if student else None,
        "saved": False,
    }
    if body.save:
        row = {
            "student_id": student["id"] if student else None,
            "features": features,
            "probability": round(probability, 4),
            "predicted_label": label,
            "model_version": model.metadata.get("version"),
            "contributions": contributions,
            "created_by": actor_id(),
        }
        inserted = g.db.table("predictions").insert(row).execute().data or []
        response["saved"] = True
        response["prediction_id"] = inserted[0].get("id") if inserted else None
        log("predict", "predictions", response["prediction_id"],
            {"student_id": row["student_id"], "probability": row["probability"], "label": label,
             "model_version": row["model_version"]})
    return jsonify(response)


@predict_bp.post("/predict/batch")
@require_role("super_admin", "placement_officer")
@rate_limit("RATE_LIMIT_IMPORT_PER_MIN")
def predict_batch():
    model, failure = _model_or_503()
    if failure:
        return failure
    try:
        body = BatchRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return error_response(400, "validation_error", "Invalid batch request", exc.errors(include_context=False))
    filters: dict[str, Any] = {}
    if body.department:
        if body.department.upper() not in {"CSE", "IT", "AIDS", "ECE"}:
            return error_response(400, "validation_error", "Unknown department")
        filters["department"] = body.department.upper()
    if body.batch_year:
        filters["batch_year"] = body.batch_year
    students = [s for s in fetch_students(filters) if s.get("placement_status") != "opted_out"]
    if body.only_unpredicted and students:
        predicted = latest_by_student("predictions", [s["id"] for s in students], "student_id, created_at")
        students = [s for s in students if s["id"] not in predicted]
    if not students:
        return jsonify({"count": 0, "placed_pred": 0, "at_risk": 0, "model_version": model.metadata.get("version")})

    frame = pd.DataFrame([{f: s.get(f) for f in MODEL_INPUT_FIELDS} for s in students])
    results = model.predict_frame(frame, explain=True)
    threshold = num(get_settings(), "at_risk_probability")
    actor = actor_id()
    rows = []
    for student, result in zip(students, results):
        label = "placed" if result["probability"] >= threshold else "not_placed"
        rows.append({
            "student_id": student["id"],
            "features": student_features(student),
            "probability": round(result["probability"], 4),
            "predicted_label": label,
            "model_version": model.metadata.get("version"),
            "contributions": result["contributions"][:6],
            "created_by": actor,
        })
    for offset in range(0, len(rows), 500):
        g.db.table("predictions").insert(rows[offset:offset + 500]).execute()
    placed = sum(r["predicted_label"] == "placed" for r in rows)
    summary = {"count": len(rows), "placed_pred": placed, "at_risk": len(rows) - placed,
               "model_version": model.metadata.get("version")}
    log("predict_batch", "predictions", None, {**summary, "filters": filters,
                                                "only_unpredicted": body.only_unpredicted})
    return jsonify(summary)


def _prediction_rows():
    student_id = (request.args.get("student_id") or "").strip()
    search = (request.args.get("search") or "").strip()
    students_by_id: dict[str, dict] = {}
    if search:
        students_by_id = {s["id"]: s for s in fetch_students({"search": search})}
        if not students_by_id:
            return []

    def factory():
        query = g.db.table("predictions").select("*")
        if student_id:
            query = query.eq("student_id", student_id)
        elif search:
            query = query.in_("student_id", list(students_by_id)[:500])
        return query.order("created_at", desc=True)

    rows = fetch_all(factory)
    missing = [r["student_id"] for r in rows if r.get("student_id") and r["student_id"] not in students_by_id]
    missing = list(dict.fromkeys(missing))
    for i in range(0, len(missing), 200):
        for s in g.db.table("students").select("id, usn, full_name, department, batch_year").in_(
                "id", missing[i:i + 200]).execute().data or []:
            students_by_id[s["id"]] = s
    for row in rows:
        s = students_by_id.get(row.get("student_id"))
        row["student"] = {k: s.get(k) for k in ("id", "usn", "full_name", "department")} if s else None
    return rows


@predict_bp.get("/predictions")
@require_auth
def list_predictions():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 10))))
    except ValueError:
        return error_response(400, "validation_error", "page and per_page must be integers")
    rows = _prediction_rows()
    start = (page - 1) * per_page
    return jsonify({"items": rows[start:start + per_page], "total": len(rows), "page": page, "per_page": per_page})


@predict_bp.get("/predictions/export.csv")
@require_auth
def export_predictions():
    rows = _prediction_rows()
    log("export", "predictions", None, {"row_count": len(rows)})
    header = ["created_at", "usn", "full_name", "department", "probability", "predicted_label",
              "model_version", *MODEL_INPUT_FIELDS]
    return csv_response(header, (
        [r.get("created_at"), (r.get("student") or {}).get("usn"), (r.get("student") or {}).get("full_name"),
         (r.get("student") or {}).get("department"), r.get("probability"), r.get("predicted_label"),
         r.get("model_version"), *[(r.get("features") or {}).get(f) for f in MODEL_INPUT_FIELDS]]
        for r in rows), "predictions")
