"""Application settings endpoints with key-specific validation."""
from __future__ import annotations

import math
from typing import Any

from flask import Blueprint, current_app, g, jsonify, request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..auth.decorators import require_auth, require_role
from ..services.audit import log
from ..services.settings_service import get_settings as get_settings_values, settings_meta

settings_bp = Blueprint("settings", __name__, url_prefix="/api/settings")


class SettingsUpdate(BaseModel):
    """Allowed setting values and their database-aligned ranges."""
    model_config = ConfigDict(extra="forbid")

    tier1_min_cgpa: float | None = Field(default=None, ge=0, le=10)
    technical_threshold: float | None = Field(default=None, ge=0, le=100)
    aptitude_threshold: float | None = Field(default=None, ge=0, le=100)
    at_risk_probability: float | None = Field(default=None, ge=0, le=1)
    skill_target: float | None = Field(default=None, ge=0, le=100)
    placement_target_rate: float | None = Field(default=None, ge=0, le=1)
    high_potential_lpa: float | None = Field(default=None, ge=0, le=200)
    dream_lpa: float | None = Field(default=None, ge=0, le=200)
    super_dream_lpa: float | None = Field(default=None, ge=0, le=200)

    @field_validator("*", mode="before")
    @classmethod
    def require_finite_number(cls, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, bool):
            raise ValueError("must be numeric")
        try:
            if not math.isfinite(float(value)):
                raise ValueError("must be finite")
        except (TypeError, ValueError) as exc:
            if isinstance(exc, ValueError) and str(exc) == "must be finite":
                raise
            raise ValueError("must be numeric") from exc
        return value


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


@settings_bp.get("")
@require_auth
def get_settings():
    """Return current settings (with defaults) as a key-to-value JSON object.

    ``_meta`` carries last-saved by/at per key for the Admin page.
    """
    values = get_settings_values()
    values["_meta"] = settings_meta()
    return jsonify(values)


@settings_bp.put("")
@require_role("super_admin")
def update_settings():
    """Validate and persist one or more settings; only super admins may write."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": {"code": "validation_error", "message": "JSON object required", "details": None}}), 400
    try:
        validated = SettingsUpdate.model_validate(payload)
    except ValidationError as exc:
        return jsonify(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed",
                    "details": exc.errors(),
                }
            }
        ), 400

    changes = validated.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        return jsonify({"error": {"code": "validation_error", "message": "Provide at least one non-null setting", "details": None}}), 400

    tiers = {**get_settings_values(), **changes}
    if not float(tiers["high_potential_lpa"]) <= float(tiers["dream_lpa"]) <= float(tiers["super_dream_lpa"]):
        return jsonify({"error": {"code": "validation_error",
                                  "message": "Package cutoffs must satisfy high potential ≤ dream ≤ super dream",
                                  "details": None}}), 400
    actor = None if g.user["user_id"] == "dev-bypass" else g.user["user_id"]
    saved: dict[str, Any] = {}
    for key, value in changes.items():
        response = g.db.table("app_settings").upsert(
            {"key": key, "value": value, "updated_by": actor, "updated_at": _now()},
            on_conflict="key",
        ).execute()
        saved[key] = value
    log("update", "app_settings", None, {"keys": sorted(changes)})
    current_app.logger.info("Updated application settings: %s", sorted(changes))
    return jsonify(saved)
