"""Admin & Settings endpoints (Phase 12): users/RBAC, audit trail, model governance."""
from __future__ import annotations

import secrets
import string
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

from flask import Blueprint, current_app, g, jsonify, request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..auth.decorators import require_role
from ..services.audit import log
from ..services.db import fetch_all, get_service_client, is_local_mode
from ..services.local_db import now_iso
from ..services.model_service import activate_version, get_model, list_versions, model_dir, public_metadata, reload_model
from ..utils.csv_utils import csv_response
from ..utils.errors import error_response

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")
Role = Literal["super_admin", "placement_officer", "faculty_mentor", "auditor"]
Department = Literal["CSE", "IT", "AIDS", "ECE"]
BACKEND_DIR = Path(__file__).resolve().parents[2]


class AdminCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = "placement_officer"
    department: Department | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        import re

        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Invalid email address")
        return value


class AdminPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Role | None = None
    is_active: bool | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    department: Department | None = None


def _temp_password() -> str:
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{core}#7a"


def _last_sign_ins() -> dict[str, str | None]:
    try:
        if is_local_mode():
            return {u["user_id"]: u.get("last_sign_in_at")
                    for u in g.db.table("local_users").select("user_id, last_sign_in_at").execute().data or []}
        service = get_service_client()
        users = service.auth.admin.list_users()
        result = {}
        for user in users or []:
            uid = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
            last = getattr(user, "last_sign_in_at", None) or (user.get("last_sign_in_at") if isinstance(user, dict) else None)
            if uid:
                result[str(uid)] = str(last) if last else None
        return result
    except Exception:
        current_app.logger.info("Could not read last sign-in times")
        return {}


# ── Users / RBAC ─────────────────────────────────────────────────────────
@admin_bp.get("/users")
@require_role("super_admin")
def list_users():
    rows = g.db.table("admin_profiles").select("*").order("created_at").execute().data or []
    sign_ins = _last_sign_ins()
    search = (request.args.get("search") or "").strip().lower()
    role = (request.args.get("role") or "").strip()
    for row in rows:
        row["last_sign_in_at"] = sign_ins.get(row["user_id"])
    if search:
        rows = [r for r in rows if search in (r.get("full_name") or "").lower() or search in (r.get("email") or "").lower()]
    if role:
        rows = [r for r in rows if r.get("role") == role]
    return jsonify({"items": rows, "total": len(rows)})


@admin_bp.post("/users")
@require_role("super_admin")
def create_user():
    try:
        body = AdminCreate.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return error_response(400, "validation_error", "Invalid administrator details", exc.errors(include_context=False))
    existing = g.db.table("admin_profiles").select("user_id").eq("email", body.email).execute().data or []
    if existing:
        return error_response(409, "duplicate_email", "An administrator with this email already exists")
    password = _temp_password()
    if is_local_mode():
        from werkzeug.security import generate_password_hash

        if g.db.table("local_users").select("user_id").eq("email", body.email).execute().data:
            return error_response(409, "duplicate_email", "A user with this email already exists")
        user_id = str(uuid.uuid4())
        g.db.table("local_users").insert({"user_id": user_id, "email": body.email,
                                          "password_hash": generate_password_hash(password),
                                          "last_sign_in_at": None}).execute()
    else:
        try:
            service = get_service_client()
            created = service.auth.admin.create_user(
                {"email": body.email, "password": password, "email_confirm": True,
                 "user_metadata": {"full_name": body.full_name}})
            user = getattr(created, "user", created)
            user_id = str(getattr(user, "id", None) or user["id"])
        except Exception as exc:
            text = str(exc).lower()
            if "already" in text or "registered" in text or "exists" in text:
                return error_response(409, "duplicate_email", "A Supabase Auth user with this email already exists")
            current_app.logger.exception("Supabase admin user creation failed")
            return error_response(502, "auth_provider_error", "Could not create the Supabase Auth user")
    profile = {"user_id": user_id, "full_name": body.full_name.strip(), "email": body.email,
               "role": body.role, "department": body.department, "is_active": True}
    g.db.table("admin_profiles").insert(profile).execute()
    log("create", "admin_profiles", user_id, {"email": body.email, "role": body.role})
    return jsonify({**profile, "temporary_password": password,
                    "note": "Share this temporary password securely; it is shown only once."}), 201


@admin_bp.patch("/users/<user_id>")
@require_role("super_admin")
def update_user(user_id: str):
    try:
        body = AdminPatch.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return error_response(400, "validation_error", "Invalid update", exc.errors(include_context=False))
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return error_response(400, "validation_error", "Nothing to update")
    rows = g.db.table("admin_profiles").select("*").eq("user_id", user_id).execute().data or []
    if not rows:
        return error_response(404, "not_found", "Administrator not found")
    target = rows[0]
    if user_id == g.user["user_id"] and changes.get("is_active") is False:
        return error_response(409, "self_deactivation", "You cannot deactivate your own account")
    demoting = target["role"] == "super_admin" and (
        ("role" in changes and changes["role"] != "super_admin") or changes.get("is_active") is False)
    if demoting:
        active_supers = [r for r in g.db.table("admin_profiles").select("user_id, role, is_active").execute().data or []
                         if r["role"] == "super_admin" and r.get("is_active")]
        if len(active_supers) <= 1:
            return error_response(409, "last_super_admin", "At least one active super_admin must remain")
    updated = g.db.table("admin_profiles").update(changes).eq("user_id", user_id).execute().data or []
    log("update", "admin_profiles", user_id, {"changes": changes})
    return jsonify(updated[0] if updated else {**target, **changes})


# ── Audit trail ──────────────────────────────────────────────────────────
def _audit_rows() -> list[dict[str, Any]]:
    action = (request.args.get("action") or "").strip()
    actor = (request.args.get("actor") or "").strip()
    entity = (request.args.get("entity") or "").strip()
    date_from = (request.args.get("from") or "").strip()
    date_to = (request.args.get("to") or "").strip()

    def factory():
        query = g.db.table("audit_log").select("*")
        if action:
            query = query.eq("action", action)
        if actor:
            query = query.eq("actor", actor)
        if entity:
            query = query.eq("entity", entity)
        if date_from:
            query = query.gte("created_at", date_from)
        if date_to:
            query = query.lte("created_at", date_to + ("T23:59:59.999999+00:00" if len(date_to) == 10 else ""))
        return query.order("created_at", desc=True)

    rows = fetch_all(factory)
    names = {p["user_id"]: p for p in g.db.table("admin_profiles").select("user_id, full_name, email").execute().data or []}
    for row in rows:
        person = names.get(row.get("actor"))
        row["actor_name"] = person["full_name"] if person else ("System / dev bypass" if not row.get("actor") else "Unknown")
        row["actor_email"] = person["email"] if person else None
    return rows


@admin_bp.get("/audit")
@require_role("super_admin", "auditor")
def audit():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(100, max(1, int(request.args.get("per_page", 15))))
    except ValueError:
        return error_response(400, "validation_error", "page and per_page must be integers")
    rows = _audit_rows()
    start = (page - 1) * per_page
    actions = sorted({r["action"] for r in rows})
    return jsonify({"items": rows[start:start + per_page], "total": len(rows), "page": page,
                    "per_page": per_page, "actions": actions})


@admin_bp.get("/audit/export.csv")
@require_role("super_admin", "auditor")
def audit_export():
    rows = _audit_rows()
    log("export", "audit_log", None, {"row_count": len(rows)})
    return csv_response(["created_at", "actor_name", "actor_email", "action", "entity", "entity_id", "meta"],
                        ([r.get("created_at"), r.get("actor_name"), r.get("actor_email"), r.get("action"),
                          r.get("entity"), r.get("entity_id"), r.get("meta")] for r in rows), "audit_trail")


# ── Model governance ─────────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _register_model(app, metadata: dict[str, Any], actor: str | None) -> str | None:
    """Upsert the model row and mark it active (service client / local store)."""
    with app.app_context():
        try:
            client = get_service_client()
            table = "ml_models"
            client.table(table).update({"is_active": False}).eq("is_active", True).execute()
            client.table(table).upsert({
                "version": metadata["version"], "algorithm": metadata["algorithm"],
                "metrics": metadata["metrics"], "feature_list": metadata["features"],
                "trained_at": metadata["trained_at"], "is_active": True,
            }, on_conflict="version").execute()
            client.table("audit_log").insert({"actor": actor, "action": "retrain", "entity": "ml_models",
                                              "entity_id": metadata["version"],
                                              "meta": {"metrics": metadata["metrics"]}}).execute()
            return None
        except Exception as exc:  # registry is optional; artifacts on disk are the source of truth
            app.logger.warning("Model registry update skipped: %s", exc)
            return "Model trained and activated; registry row not written (service key not configured)."


def _run_job(app, job_id: str, actor: str | None) -> None:
    job = _jobs[job_id]
    job.update(status="running", started_at=now_iso())
    command = [sys.executable, "-m", "ml.train", "--output", str(model_dir(app))]
    try:
        completed = subprocess.run(command, cwd=BACKEND_DIR, capture_output=True, text=True, timeout=1800)
        job["log_tail"] = (completed.stdout + completed.stderr)[-3000:]
        if completed.returncode != 0:
            job.update(status="failed", error="Training process exited with an error", finished_at=now_iso())
            return
        model = reload_model(app)
        metadata = model.metadata if model else {}
        job["version"] = metadata.get("version")
        job["metrics"] = metadata.get("metrics")
        job["note"] = _register_model(app, metadata, actor)
        job.update(status="succeeded", finished_at=now_iso())
    except subprocess.TimeoutExpired:
        job.update(status="failed", error="Training timed out", finished_at=now_iso())
    except Exception as exc:
        app.logger.exception("Retrain job failed")
        job.update(status="failed", error=type(exc).__name__, finished_at=now_iso())


@admin_bp.get("/model")
@require_role("super_admin", "auditor")
def model_overview():
    model = get_model()
    versions = list_versions()
    try:
        registry = {r["version"]: r for r in g.db.table("ml_models").select("*").execute().data or []}
    except Exception:
        registry = {}
    active_version = model.metadata.get("version") if model else None
    for v in versions:
        v["is_active"] = v["version"] == active_version
        v["registered"] = v["version"] in registry
    with _jobs_lock:
        running = next((j for j in _jobs.values() if j["status"] in {"queued", "running"}), None)
    return jsonify({"active": public_metadata(model), "versions": versions, "running_job": running})


@admin_bp.post("/model/retrain")
@require_role("super_admin")
def retrain():
    with _jobs_lock:
        if any(j["status"] in {"queued", "running"} for j in _jobs.values()):
            return error_response(409, "job_running", "A retraining job is already running")
        job_id = uuid.uuid4().hex[:12]
        _jobs[job_id] = {"id": job_id, "status": "queued", "created_at": now_iso(),
                         "requested_by": g.user.get("email"), "version": None, "error": None}
    actor = None if g.user["user_id"] == "dev-bypass" else g.user["user_id"]
    log("retrain_start", "ml_models", job_id, {})
    app = current_app._get_current_object()
    thread = threading.Thread(target=_run_job, args=(app, job_id, actor), daemon=True)
    thread.start()
    return jsonify(_jobs[job_id]), 202


@admin_bp.get("/model/jobs/<job_id>")
@require_role("super_admin")
def job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return error_response(404, "not_found", "Job not found")
    return jsonify(job)


@admin_bp.post("/model/activate/<version>")
@require_role("super_admin")
def activate(version: str):
    try:
        model = activate_version(version)
    except (FileNotFoundError, ValueError):
        return error_response(404, "not_found", f"Model version {version} not found")
    metadata = model.metadata if model else {}
    try:
        g.db.table("ml_models").update({"is_active": False}).eq("is_active", True).execute()
        g.db.table("ml_models").upsert({
            "version": metadata["version"], "algorithm": metadata["algorithm"], "metrics": metadata["metrics"],
            "feature_list": metadata["features"], "trained_at": metadata["trained_at"], "is_active": True,
        }, on_conflict="version").execute()
    except Exception:
        current_app.logger.info("ml_models registry not updated on activate")
    log("activate", "ml_models", version, {})
    return jsonify({"active": public_metadata(model)})


@admin_bp.get("/system")
@require_role("super_admin", "auditor")
def system_info():
    """Read-only runtime configuration for the Admin page (no secrets)."""
    return jsonify({
        "data_backend": current_app.config.get("DATA_BACKEND"),
        "cors_origins": current_app.config.get("CORS_ORIGINS", []),
        "model_dir": str(model_dir()),
        "rate_limits": {"predict_per_min": current_app.config.get("RATE_LIMIT_PREDICT_PER_MIN"),
                        "import_per_min": current_app.config.get("RATE_LIMIT_IMPORT_PER_MIN")},
        "max_upload_mb": round(current_app.config.get("MAX_CONTENT_LENGTH", 0) / 1024 / 1024, 1),
    })
