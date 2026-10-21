"""
PlacementAI Backend — Application Factory.

Usage:
    from app import create_app
    app = create_app()

The factory pattern lets us create isolated app instances for testing
without touching module-level globals.
"""
from pathlib import Path

from flask import Flask
from flask_cors import CORS

from .config import Config
from .routes.auth import auth_bp
from .routes.health import health_bp
from .routes.settings import settings_bp
from .routes.students import students_bp
from .routes.predict import predict_bp
from .routes.dashboard import dashboard_bp
from .routes.analytics import analytics_bp
from .routes.skills import skills_bp
from .routes.admin import admin_bp
from .utils.errors import register_error_handlers


def create_app(config_object: type = Config) -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config.from_object(config_object)

    if app.config.get("DEV_BYPASS_AUTH"):
        app.logger.warning("=" * 60)
        app.logger.warning("!!! AUTH BYPASS ENABLED — LOCAL DEVELOPMENT ONLY !!!")
        app.logger.warning("Authentication and RLS are bypassed; service-role access is active.")
        app.logger.warning("=" * 60)

    # Load the trained pipeline once per application process. A missing
    # artifact is a valid startup state during initial setup.
    from .services.model_service import load_model

    try:
        app.extensions["model"] = load_model(app)
    except Exception:
        app.logger.exception("Could not load configured placement model")
        app.extensions["model"] = None

    if app.config.get("DATA_BACKEND") == "local":
        _init_local_store(app)

    # ── CORS ────────────────────────────────────────────────────────────
    # Only allow origins listed in CORS_ORIGINS to prevent credential leakage.
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    # ── Blueprints ──────────────────────────────────────────────────────
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(students_bp)
    app.register_blueprint(predict_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(skills_bp)
    app.register_blueprint(admin_bp)
    register_error_handlers(app)

    return app


def _init_local_store(app: Flask) -> None:
    """Create and seed the JSON demo store on first run (local mode only)."""
    from .services.local_db import get_store

    path = Path(app.config.get("LOCAL_DB_PATH", "instance/local_db.json"))
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / path
    store = get_store(path)
    if store.is_empty():
        store.seed(app.config["LOCAL_ADMIN_EMAIL"], app.config["LOCAL_ADMIN_PASSWORD"])
        app.logger.warning(
            "Local demo mode: seeded %s students. Sign in as %s / %s",
            len(store.data["students"]), app.config["LOCAL_ADMIN_EMAIL"],
            app.config["LOCAL_ADMIN_PASSWORD"],
        )
    else:
        app.logger.info("Local demo mode: using data store %s", path)
