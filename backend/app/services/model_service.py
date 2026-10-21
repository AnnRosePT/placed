"""Access, reload and version management for the placement model."""
from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any

from flask import current_app

_reload_lock = threading.Lock()


def model_dir(app=None) -> Path:
    app = app or current_app
    configured = app.config.get("MODEL_DIR", "ml/artifacts")
    path = Path(configured)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return path


def load_model(app) -> Any:
    from ml.predict import PlacementModel

    path = model_dir(app)
    if (path / "model.joblib").is_file() and (path / "metadata.json").is_file():
        model = PlacementModel.load(path)
        app.logger.info("Loaded placement model %s from %s", model.metadata.get("version"), path)
        return model
    app.logger.warning("No model artifacts in %s — run `python -m ml.train` from backend/", path)
    return None


def get_model():
    return current_app.extensions.get("model")


def reload_model(app=None):
    app = app or current_app._get_current_object()
    with _reload_lock:
        app.extensions["model"] = load_model(app)
        return app.extensions["model"]


def list_versions(app=None) -> list[dict[str, Any]]:
    root = model_dir(app) / "versions"
    versions = []
    if root.is_dir():
        for child in root.iterdir():
            meta = child / "metadata.json"
            if meta.is_file() and (child / "model.joblib").is_file():
                data = json.loads(meta.read_text(encoding="utf-8"))
                versions.append({
                    "version": data.get("version", child.name),
                    "algorithm": data.get("algorithm"),
                    "metrics": data.get("metrics", {}),
                    "trained_at": data.get("trained_at"),
                    "dataset_source": data.get("dataset_source"),
                    "training_rows": data.get("training_rows"),
                })
    versions.sort(key=lambda v: v.get("trained_at") or "", reverse=True)
    return versions


def activate_version(version: str, app=None):
    app = app or current_app._get_current_object()
    if "/" in version or "\\" in version or version.startswith("."):
        raise ValueError("Invalid version")
    source = model_dir(app) / "versions" / version
    if not (source / "model.joblib").is_file():
        raise FileNotFoundError(version)
    target = model_dir(app)
    with _reload_lock:
        for name in ("model.joblib", "metadata.json"):
            tmp = target / f".{name}.tmp"
            shutil.copyfile(source / name, tmp)
            os.replace(tmp, target / name)
    return reload_model(app)


def public_metadata(model) -> dict[str, Any] | None:
    if model is None:
        return None
    meta = model.metadata
    keys = ["version", "algorithm", "features", "unused_by_model", "metrics", "confusion_matrix",
            "calibration_curve", "feature_importances", "trained_at", "dataset_source",
            "training_rows", "best_params"]
    return {k: meta.get(k) for k in keys}
