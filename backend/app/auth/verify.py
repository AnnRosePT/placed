"""Supabase access-token verification with generic failure responses."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import jwt
from flask import current_app
from jwt import PyJWKClient

from ..services.db import get_user_client, is_local_mode

LOCAL_ISSUER = "placementai-local"


def issue_local_token(user_id: str, email: str) -> tuple[str, int]:
    """Sign an HS256 access token for local demo mode."""
    import time

    ttl = int(current_app.config.get("LOCAL_TOKEN_TTL_SECONDS", 28800))
    expires_at = int(time.time()) + ttl
    token = jwt.encode(
        {"sub": user_id, "email": email, "aud": "authenticated", "iss": LOCAL_ISSUER,
         "exp": expires_at, "iat": int(time.time())},
        current_app.config["SECRET_KEY"], algorithm="HS256",
    )
    return token, expires_at


class AuthenticationError(Exception):
    """Raised when an access token cannot be authenticated."""


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    """Cache JWKS clients by URL (PyJWKClient also caches signing keys)."""
    return PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=300)


def _claims_to_identity(claims: dict[str, Any]) -> dict[str, str | None]:
    subject = claims.get("sub")
    if not subject:
        raise AuthenticationError
    return {"user_id": str(subject), "email": claims.get("email")}


def verify_supabase_jwt(token: str) -> dict[str, str | None]:
    """Verify an Auth JWT and return its user identity, without leaking errors."""
    if not token:
        raise AuthenticationError

    config = current_app.config
    if is_local_mode():
        try:
            claims = jwt.decode(
                token, config["SECRET_KEY"], algorithms=["HS256"], audience="authenticated",
                issuer=LOCAL_ISSUER, options={"require": ["sub", "exp", "aud", "iss"]},
            )
            return _claims_to_identity(claims)
        except Exception as exc:
            raise AuthenticationError from exc

    base_url = str(config.get("SUPABASE_URL", "")).rstrip("/")
    if base_url:
        try:
            signing_key = _jwks_client(
                f"{base_url}/auth/v1/.well-known/jwks.json"
            ).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                options={"require": ["sub", "exp", "aud"]},
            )
            return _claims_to_identity(claims)
        except Exception:
            # A configured legacy secret or Supabase Auth introspection may still
            # validate tokens whose signing key is not available through JWKS.
            pass

    secret = config.get("SUPABASE_JWT_SECRET")
    if secret:
        try:
            claims = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["sub", "exp", "aud"]},
            )
            return _claims_to_identity(claims)
        except Exception:
            pass

    try:
        client = get_user_client(token)
        response = client.auth.get_user(token)
        user = getattr(response, "user", None)
        if user is None and isinstance(response, dict):
            user = response.get("user")
        user_id = getattr(user, "id", None) if user is not None else None
        email = getattr(user, "email", None) if user is not None else None
        if isinstance(user, dict):
            user_id = user.get("id")
            email = user.get("email")
        if not user_id:
            raise AuthenticationError
        return {"user_id": str(user_id), "email": email}
    except Exception as exc:
        current_app.logger.info("Supabase token verification failed")
        raise AuthenticationError from exc