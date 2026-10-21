"""Executive dashboard aggregation (Phase 9)."""
from __future__ import annotations

from typing import Any

import pandas as pd
from flask import Blueprint, g, jsonify, request

from ..auth.decorators import require_auth
from ..services.data import DEPARTMENTS, FilterError, fetch_students, latest_by_student, parse_filters
from ..services.model_service import get_model
from ..services.settings_service import get_settings, num
from ..utils.csv_utils import csv_response
from ..services.audit import log
from ..utils.errors import error_response

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")

TIERS = [
    ("tier1", "> 9.0", 9.0, 10.01),
    ("tier2", "8.0 – 8.9", 8.0, 9.0),
    ("tier3", "7.0 – 7.9", 7.0, 8.0),
    ("tier4", "< 7.0", 0.0, 7.0),
]


def _frame(students: list[dict[str, Any]]) -> pd.DataFrame:
    columns = ["id", "usn", "full_name", "department", "batch_year", "cgpa", "placement_status",
               "company", "package_lpa"]
    frame = pd.DataFrame(students, columns=columns) if students else pd.DataFrame(columns=columns)
    frame["cgpa"] = pd.to_numeric(frame["cgpa"], errors="coerce")
    frame["package_lpa"] = pd.to_numeric(frame["package_lpa"], errors="coerce")
    return frame


def _rate(placed: int, eligible: int) -> float | None:
    return round(placed / eligible, 4) if eligible else None


def _kpis(frame: pd.DataFrame, target_rate: float) -> dict[str, Any]:
    eligible = frame[frame["placement_status"] != "opted_out"]
    placed = frame[frame["placement_status"] == "placed"]
    total_eligible = int(len(eligible))
    placed_n = int(len(placed))
    rate = _rate(placed_n, total_eligible)
    needed = max(0, int(-(-target_rate * total_eligible // 1)) - placed_n) if total_eligible else 0
    cg = placed["cgpa"].dropna()
    return {
        "total_students": int(len(frame)),
        "total_eligible": total_eligible,
        "opted_out": int((frame["placement_status"] == "opted_out").sum()),
        "placed": placed_n,
        "in_process": int((frame["placement_status"] == "in_process").sum()),
        "not_placed": int((frame["placement_status"] == "not_placed").sum()),
        "placement_rate": rate,
        "target_rate": target_rate,
        "students_to_target": needed,
        "avg_placed_cgpa": round(float(cg.mean()), 2) if len(cg) else None,
        "min_placed_cgpa": round(float(cg.min()), 2) if len(cg) else None,
        "max_placed_cgpa": round(float(cg.max()), 2) if len(cg) else None,
        "recruiting_companies": int(placed["company"].dropna().replace("", pd.NA).dropna().nunique()),
    }


def build_dashboard(filters: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    threshold = num(settings, "at_risk_probability")
    target_rate = num(settings, "placement_target_rate")
    students = fetch_students(filters)
    frame = _frame(students)
    kpis = _kpis(frame, target_rate)

    # Year-over-year: compare against the previous batch with the same department/status filters.
    yoy = {"placement_rate": None, "placed": None, "avg_placed_cgpa": None, "previous_batch": None}
    if filters.get("batch_year"):
        prev_filters = {**filters, "batch_year": filters["batch_year"] - 1}
        prev = _frame(fetch_students(prev_filters))
        if len(prev):
            prev_kpis = _kpis(prev, target_rate)
            yoy["previous_batch"] = prev_filters["batch_year"]
            if prev_kpis["placement_rate"] is not None and kpis["placement_rate"] is not None:
                yoy["placement_rate"] = round(kpis["placement_rate"] - prev_kpis["placement_rate"], 4)
            yoy["placed"] = kpis["placed"] - prev_kpis["placed"]
            if prev_kpis["avg_placed_cgpa"] is not None and kpis["avg_placed_cgpa"] is not None:
                yoy["avg_placed_cgpa"] = round(kpis["avg_placed_cgpa"] - prev_kpis["avg_placed_cgpa"], 2)
            yoy["previous"] = prev_kpis
    kpis["yoy"] = yoy

    outcome = {status: int((frame["placement_status"] == status).sum())
               for status in ("placed", "in_process", "not_placed", "opted_out")}

    departments = []
    for dept in DEPARTMENTS:
        sub = frame[frame["department"] == dept]
        if not len(sub):
            continue
        eligible = int((sub["placement_status"] != "opted_out").sum())
        placed = int((sub["placement_status"] == "placed").sum())
        departments.append({"department": dept, "placed": placed, "eligible": eligible,
                            "total": int(len(sub)), "rate": _rate(placed, eligible)})

    latest = latest_by_student("predictions", [s["id"] for s in students],
                               "student_id, probability, created_at") if students else {}
    frame["probability"] = frame["id"].map(lambda i: float(latest[i]["probability"]) if i in latest else None)

    tiers = []
    for key, label, low, high in TIERS:
        sub = frame[(frame["cgpa"] >= low) & (frame["cgpa"] < high)]
        eligible = sub[sub["placement_status"] != "opted_out"]
        placed = int((eligible["placement_status"] == "placed").sum())
        probs = pd.to_numeric(sub["probability"], errors="coerce").dropna()
        tiers.append({"tier": key, "label": label, "min": low, "max": min(high, 10.0),
                      "candidates": int(len(sub)), "eligible": int(len(eligible)), "placed": placed,
                      "rate": _rate(placed, int(len(eligible))),
                      "avg_predicted_probability": round(float(probs.mean()), 4) if len(probs) else None,
                      "predicted_count": int(len(probs))})

    placed = frame[(frame["placement_status"] == "placed") & frame["company"].notna() & (frame["company"] != "")]
    recruiters = []
    if len(placed):
        grouped = placed.groupby("company").agg(hires=("id", "count"), max_package=("package_lpa", "max"),
                                                avg_package=("package_lpa", "mean"))
        grouped = grouped.sort_values(["hires", "max_package"], ascending=[False, False]).head(5)
        for company, row in grouped.iterrows():
            recruiters.append({"company": company, "hires": int(row["hires"]),
                               "max_package_lpa": None if pd.isna(row["max_package"]) else round(float(row["max_package"]), 2),
                               "avg_package_lpa": None if pd.isna(row["avg_package"]) else round(float(row["avg_package"]), 2)})
    packages = placed["package_lpa"].dropna()
    median_package = round(float(packages.median()), 2) if len(packages) else None

    at_risk = [sid for sid, p in latest.items() if float(p["probability"]) < threshold
               and frame.loc[frame["id"] == sid, "placement_status"].isin(["in_process", "not_placed"]).any()]

    model = get_model()
    model_meta = model.metadata if model else {}
    return {
        "filters": filters,
        "kpis": kpis,
        "outcome_distribution": outcome,
        "department_performance": departments,
        "cgpa_tiers": tiers,
        "top_recruiters": recruiters,
        "median_package_lpa": median_package,
        "at_risk_count": len(at_risk),
        "predicted_students": len(latest),
        "threshold": threshold,
        "batches": sorted({int(s["batch_year"]) for s in fetch_students({}) if s.get("batch_year")}),
        "model": {"version": model_meta.get("version"), "algorithm": model_meta.get("algorithm"),
                  "accuracy": (model_meta.get("metrics") or {}).get("accuracy"),
                  "roc_auc": (model_meta.get("metrics") or {}).get("roc_auc"),
                  "trained_at": model_meta.get("trained_at")} if model else None,
    }


def recent_activity(limit: int = 10) -> list[dict[str, Any]]:
    try:
        rows = g.db.table("audit_log").select("*").order("created_at", desc=True).limit(limit).execute().data or []
    except Exception:
        return []
    student_ids = [r["entity_id"] for r in rows if r.get("entity") == "students" and r.get("entity_id")]
    for r in rows:
        meta = r.get("meta") or {}
        if meta.get("student_id"):
            student_ids.append(meta["student_id"])
    names: dict[str, dict] = {}
    if student_ids:
        for s in g.db.table("students").select("id, usn, full_name").in_("id", list(set(student_ids))).execute().data or []:
            names[s["id"]] = s
    actors: dict[str, str] = {}
    actor_ids = list({r["actor"] for r in rows if r.get("actor")})
    if actor_ids:
        for a in g.db.table("admin_profiles").select("user_id, full_name").in_("user_id", actor_ids).execute().data or []:
            actors[a["user_id"]] = a["full_name"]
    for r in rows:
        meta = r.get("meta") or {}
        sid = r.get("entity_id") if r.get("entity") == "students" else meta.get("student_id")
        r["student"] = names.get(sid)
        r["actor_name"] = actors.get(r.get("actor"))
    return rows


@dashboard_bp.get("")
@require_auth
def dashboard():
    try:
        filters = parse_filters(request.args)
    except FilterError as exc:
        return error_response(400, "validation_error", str(exc))
    data = build_dashboard(filters)
    data["recent_activity"] = recent_activity()
    data["activity_visible"] = g.role in {"super_admin", "auditor"}
    return jsonify(data)


@dashboard_bp.get("/activity")
@require_auth
def activity():
    return jsonify({"items": recent_activity(), "visible": g.role in {"super_admin", "auditor"}})


@dashboard_bp.get("/summary.csv")
@require_auth
def export_summary():
    try:
        filters = parse_filters(request.args)
    except FilterError as exc:
        return error_response(400, "validation_error", str(exc))
    data = build_dashboard(filters)
    k = data["kpis"]
    rows = [["kpi", "total_eligible", k["total_eligible"]], ["kpi", "placed", k["placed"]],
            ["kpi", "placement_rate", k["placement_rate"]], ["kpi", "target_rate", k["target_rate"]],
            ["kpi", "students_to_target", k["students_to_target"]], ["kpi", "opted_out", k["opted_out"]],
            ["kpi", "avg_placed_cgpa", k["avg_placed_cgpa"]], ["kpi", "at_risk_count", data["at_risk_count"]]]
    for d in data["department_performance"]:
        rows.append([f"department:{d['department']}", "placed/eligible", f"{d['placed']}/{d['eligible']}"])
        rows.append([f"department:{d['department']}", "rate", d["rate"]])
    log("export", "dashboard_summary", None, {"filters": filters})
    return csv_response(["section", "metric", "value"], rows, "placement_summary")
