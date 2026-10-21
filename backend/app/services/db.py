"""Data-client factories: Supabase (user-scoped / service) or the local demo store."""
from __future__ import annotations

from pathlib import Path

from flask import current_app


def is_local_mode() -> bool:
    return current_app.config.get("DATA_BACKEND") == "local"


def get_local_client():
    from .local_db import LocalClient, get_store

    path = Path(current_app.config.get("LOCAL_DB_PATH", "instance/local_db.json"))
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return LocalClient(get_store(path))


def get_user_client(token: str):
    """Create an anon-key client scoped to the caller's JWT (RLS applies)."""
    if is_local_mode():
        return get_local_client()
    from supabase import create_client

    url = current_app.config.get("SUPABASE_URL")
    anon_key = current_app.config.get("SUPABASE_ANON_KEY")
    if not url or not anon_key:
        raise RuntimeError("Supabase user client is not configured")
    client = create_client(url, anon_key)
    client.postgrest.auth(token)
    return client


def get_service_client():
    """Create a service-role client; use only for trusted admin operations."""
    if is_local_mode():
        return get_local_client()
    from supabase import create_client

    url = current_app.config.get("SUPABASE_URL")
    service_key = current_app.config.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise RuntimeError("Supabase service client is not configured")
    return create_client(url, service_key)


def fetch_all(query_factory, page_size: int = 1000) -> list[dict]:
    """Page through a select query (PostgREST caps responses at ~1000 rows)."""
    rows: list[dict] = []
    start = 0
    while True:
        batch = query_factory().range(start, start + page_size - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        start += page_size
