"""Authentication and current-admin profile endpoints."""
from flask import Blueprint, current_app, g, jsonify, request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..auth.decorators import require_auth
from ..auth.verify import issue_local_token
from ..services.db import get_local_client, is_local_mode
from ..services.local_db import now_iso
from ..utils.errors import error_response
from ..utils.ratelimit import rate_limit

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


class LocalLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


@auth_bp.get("/me")
@require_auth
def me():
    """Return the authenticated administrator's public profile."""
    return jsonify(
        {
            "user_id": g.user["user_id"],
            "email": g.user["email"],
            "full_name": g.user["full_name"],
            "role": g.user["role"],
            "department": g.user["department"],
            "last_sign_in_at": g.user.get("last_sign_in_at"),
        }
    )


@auth_bp.post("/login")
@rate_limit("RATE_LIMIT_IMPORT_PER_MIN")
def local_login():
    """Email/password sign-in for local demo mode only (Supabase Auth handles production)."""
    if not is_local_mode():
        return error_response(404, "not_found", "Local sign-in is disabled; use Supabase Auth")
    from werkzeug.security import check_password_hash

    try:
        body = LocalLogin.model_validate(request.get_json(silent=True) or {})
    except ValidationError as exc:
        return error_response(400, "validation_error", "Email and password are required",
                              exc.errors(include_context=False))
    db = get_local_client()
    users = db.table("local_users").select("*").eq("email", body.email.strip().lower()).execute().data
    user = users[0] if users else None
    if not user or not check_password_hash(user["password_hash"], body.password):
        return error_response(401, "invalid_credentials", "Invalid email or password")
    profiles = db.table("admin_profiles").select("*").eq("user_id", user["user_id"]).execute().data
    if not profiles or not profiles[0].get("is_active"):
        return error_response(403, "forbidden", "This account is not an authorized administrator.")
    db.table("local_users").update({"last_sign_in_at": now_iso()}).eq("user_id", user["user_id"]).execute()
    token, expires_at = issue_local_token(user["user_id"], user["email"])
    current_app.logger.info("Local sign-in for %s", user["email"])
    return jsonify({"access_token": token, "expires_at": expires_at,
                    "user": {"id": user["user_id"], "email": user["email"],
                             "last_sign_in_at": user.get("last_sign_in_at")}})
