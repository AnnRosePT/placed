"""
Health blueprint — GET /api/health

Intentionally unauthenticated so load-balancers and monitoring can probe it.
Reports only non-sensitive status.
"""
from flask import Blueprint, current_app, jsonify

health_bp = Blueprint("health", __name__, url_prefix="/api")


@health_bp.get("/health")
def health():
    """Return service liveness, model and data-store status."""
    model = current_app.extensions.get("model")
    backend = current_app.config.get("DATA_BACKEND", "supabase")
    db_status = "unknown"
    if backend == "local":
        try:
            from ..services.db import get_local_client

            get_local_client().table("app_settings").select("key").limit(1).execute()
            db_status = "ok"
        except Exception:
            db_status = "unavailable"
    elif current_app.config.get("SUPABASE_URL") and current_app.config.get("SUPABASE_ANON_KEY"):
        try:
            from supabase import create_client

            client = create_client(
                current_app.config["SUPABASE_URL"],
                current_app.config["SUPABASE_ANON_KEY"],
            )
            client.table("app_settings").select("key").limit(1).execute()
            db_status = "ok"
        except Exception:
            db_status = "unavailable"
    meta = model.metadata if model else {}
    return jsonify(
        {
            "status": "ok",
            "version": "1.0.0",
            "model_loaded": model is not None,
            "model_version": meta.get("version"),
            "model_algorithm": meta.get("algorithm"),
            "model_roc_auc": (meta.get("metrics") or {}).get("roc_auc"),
            "dataset_source": meta.get("dataset_source"),
            "db": db_status,
            "auth_mode": "local" if backend == "local" else "supabase",
        }
    ), 200
