"""Read app_settings with safe defaults."""
from __future__ import annotations

from typing import Any

from flask import g

from .local_db import DEFAULT_SETTINGS


def get_settings(db=None) -> dict[str, Any]:
    client = db or g.db
    try:
        rows = client.table("app_settings").select("key, value, updated_by, updated_at").execute().data or []
    except Exception:
        rows = []
    values: dict[str, Any] = dict(DEFAULT_SETTINGS)
    for row in rows:
        values[row["key"]] = row["value"]
    return values


def settings_meta(db=None) -> dict[str, Any]:
    client = db or g.db
    try:
        rows = client.table("app_settings").select("key, updated_by, updated_at").execute().data or []
    except Exception:
        return {}
    return {row["key"]: {"updated_by": row.get("updated_by"), "updated_at": row.get("updated_at")} for row in rows}


def num(settings: dict[str, Any], key: str) -> float:
    try:
        return float(settings.get(key, DEFAULT_SETTINGS[key]))
    except (TypeError, ValueError):
        return float(DEFAULT_SETTINGS[key])
