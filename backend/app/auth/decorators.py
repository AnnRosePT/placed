"""Flask authentication and admin-role decorators."""
from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from flask import current_app, g, jsonify, request

from ..services.db import get_service_client, get_user_client
from .verify import AuthenticationError, verify_supabase_jwt


def _error(status: int, code: str, message: str):
    return jsonify({"error": {"code": code, "message": message, "details": None}}), status


def _set_dev_bypass_context() -> None:
    """Populate the request context with a local super-admin and RLS-bypassing DB."""
    g.user = {
        "user_id": "dev-bypass",
        "email": "dev@local",
        "full_name": "Dev Bypass",
        "role": "super_admin",
        "department": None,
    }
    g.role = "super_admin"
    g.db = get_service_client()
    g.access_token = None


def require_auth(view: Callable[..., Any]) -> Callable[..., Any]:
    """Authenticate the bearer token and require an active admin profile."""
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any):
        if current_app.config.get("DEV_BYPASS_AUTH"):
            _set_dev_bypass_context()
            return view(*args, **kwargs)

        header = request.headers.get("Authorization", "")
        scheme, separator, token = header.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token.strip():
            return _error(401, "unauthorized", "Authentication required")
        token = token.strip()
        try:
            identity = verify_supabase_jwt(token)
            client = get_user_client(token)
            result = (
                client.table("admin_profiles")
                .select("user_id, full_name, email, role, department, is_active")
                .eq("user_id", identity["user_id"])
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            profiles = result.data or []
            if not profiles:
                return _error(403, "forbidden", "An active administrator profile is required")
            profile = profiles[0]
        except AuthenticationError:
            return _error(401, "unauthorized", "Invalid authentication credentials")
        except Exception:
            current_app.logger.exception("Admin profile lookup failed")
            return _error(403, "forbidden", "An active administrator profile is required")

        last_sign_in_at = None
        if current_app.config.get("DATA_BACKEND") == "local":
            try:
                users = client.table("local_users").select("last_sign_in_at").eq(
                    "user_id", identity["user_id"]).execute().data or []
                last_sign_in_at = users[0].get("last_sign_in_at") if users else None
            except Exception:
                last_sign_in_at = None
        g.user = {
            "last_sign_in_at": last_sign_in_at,
            "user_id": identity["user_id"],
            "email": identity.get("email") or profile.get("email"),
            "full_name": profile.get("full_name"),
            "role": profile.get("role"),
            "department": profile.get("department"),
        }
        g.role = profile.get("role")
        g.db = client
        g.access_token = token
        return view(*args, **kwargs)

    return wrapped


def require_role(*roles: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Require one of the specified roles after admin authentication."""
    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        @require_auth
        def authenticated_view(*args: Any, **kwargs: Any):
            if g.role not in roles:
                return _error(403, "forbidden", "Insufficient permissions")
            return view(*args, **kwargs)

        @wraps(view)
        def wrapped(*args: Any, **kwargs: Any):
            if current_app.config.get("DEV_BYPASS_AUTH"):
                _set_dev_bypass_context()
                return view(*args, **kwargs)
            return authenticated_view(*args, **kwargs)

        return wrapped

    return decorator