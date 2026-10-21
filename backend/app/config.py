"""
PlacementAI Backend — Configuration.

Reads all settings from environment variables via python-dotenv.
Never hardcode URLs, ports, or credentials here.
"""
import os
from dotenv import load_dotenv

# Load .env from the backend directory (or project root if run from there).
load_dotenv()


def _parse_cors_origins(raw: str) -> list[str]:
    """Split a comma-separated CORS_ORIGINS string into a list."""
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


class Config:
    """Base configuration — all settings read from environment."""

    # Flask
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-me")
    FLASK_ENV: str = os.getenv("FLASK_ENV", "development")
    DEBUG: bool = FLASK_ENV == "development"

    # Supabase
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")  # legacy HS256
    DEV_BYPASS_AUTH: bool = os.getenv("DEV_BYPASS_AUTH", "false").strip().lower() == "true"

    # CORS — comma-separated list of allowed origins
    CORS_ORIGINS: list[str] = _parse_cors_origins(
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )

    # Data backend: "supabase" (production) or "local" (JSON demo store, no Supabase needed).
    # Defaults to local when SUPABASE_URL is not set so a fresh clone runs out of the box.
    DATA_BACKEND: str = (os.getenv("DATA_BACKEND") or ("supabase" if SUPABASE_URL else "local")).lower()
    LOCAL_DB_PATH: str = os.getenv("LOCAL_DB_PATH", "instance/local_db.json")
    LOCAL_ADMIN_EMAIL: str = os.getenv("LOCAL_ADMIN_EMAIL", "admin@placementai.local")
    LOCAL_ADMIN_PASSWORD: str = os.getenv("LOCAL_ADMIN_PASSWORD", "Admin@123")
    LOCAL_TOKEN_TTL_SECONDS: int = int(os.getenv("LOCAL_TOKEN_TTL_SECONDS", "28800"))

    # Request limits
    MAX_CONTENT_LENGTH: int = 6 * 1024 * 1024
    RATE_LIMIT_PREDICT_PER_MIN: int = int(os.getenv("RATE_LIMIT_PREDICT_PER_MIN", "60"))
    RATE_LIMIT_IMPORT_PER_MIN: int = int(os.getenv("RATE_LIMIT_IMPORT_PER_MIN", "10"))

    # ML
    MODEL_DIR: str = os.getenv("MODEL_DIR", "ml/artifacts")


class TestingConfig(Config):
    """Configuration used by pytest."""

    TESTING: bool = True
    DEBUG: bool = True
    # Role and auth tests must exercise the real decorator path by default.
    DEV_BYPASS_AUTH: bool = False
    DATA_BACKEND: str = "supabase"
    RATE_LIMIT_PREDICT_PER_MIN: int = 10_000
    RATE_LIMIT_IMPORT_PER_MIN: int = 10_000
    # Allow any origin during testing so we don't need a real browser.
    CORS_ORIGINS: list[str] = ["*"]
