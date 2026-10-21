"""CLI model training and artifact generation."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.calibration import calibration_curve

try:
    from .preprocess import FEATURES, UNUSED_BY_MODEL, build_preprocessor, load_raw, preprocess
except ImportError:  # pragma: no cover - direct CLI execution
    from preprocess import FEATURES, UNUSED_BY_MODEL, build_preprocessor, load_raw, preprocess

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "backend" / "ml" / "artifacts"


def _candidate_searches(seed: int, folds: StratifiedKFold, features: list[str]) -> list[GridSearchCV]:
    candidates: list[tuple[str, Any, dict[str, list[Any]]]] = [
        (
            "logistic_regression",
            LogisticRegression(max_iter=1200, random_state=seed, class_weight="balanced"),
            {"classifier__C": [0.5, 1.5]},
        ),
        (
            "random_forest",
            RandomForestClassifier(random_state=seed, class_weight="balanced", n_jobs=1),
            {"classifier__n_estimators": [90, 140], "classifier__max_depth": [None, 12]},
        ),
        (
            "gradient_boosting",
            GradientBoostingClassifier(random_state=seed),
            {"classifier__n_estimators": [80, 120], "classifier__learning_rate": [0.06]},
        ),
    ]
    searches = []
    for _, estimator, grid in candidates:
        pipeline = Pipeline(
            [
                ("preprocessor", build_preprocessor(features)),
                ("classifier", estimator),
            ]
        )
        searches.append(
            GridSearchCV(
                pipeline,
                grid,
                scoring="roc_auc",
                cv=folds,
                n_jobs=-1,
                refit=True,
                error_score="raise",
            )
        )
    return searches


def train_model(
    data: Any | None = None,
    *,
    dataset_source: str | None = None,
    output_dir: str | Path = DEFAULT_OUTPUT,
    seed: int = 42,
    activate: bool = True,
) -> dict[str, Any]:
    """Train, evaluate, save, and return metadata; exposed for tests and CLI."""
    if data is None:
        raw, detected_source = load_raw()
    else:
        raw, detected_source = data.copy(), dataset_source or "synthetic"
    if dataset_source:
        detected_source = dataset_source
    cleaned = preprocess(raw)
    # preprocess updates its own module globals after discovering actual columns.
    try:
        from . import preprocess as preprocessing_module
    except ImportError:  # pragma: no cover - direct CLI execution
        import preprocess as preprocessing_module
    features = list(preprocessing_module.FEATURES)
    unused = list(preprocessing_module.UNUSED_BY_MODEL)
    X = cleaned[features]
    y = cleaned["target"]
    if int(y.value_counts().min()) < 5:
        raise ValueError("Each target class must contain at least five rows for 5-fold CV")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=seed,
        stratify=y,
    )
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    searches = _candidate_searches(seed, folds, features)
    for search in searches:
        search.fit(X_train, y_train)
    best_search = max(searches, key=lambda search: search.best_score_)
    model = best_search.best_estimator_
    best_cv_mean = float(best_search.best_score_)
    best_cv_std = float(best_search.cv_results_["std_test_score"][best_search.best_index_])
    probabilities = model.predict_proba(X_test)[:, 1]
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "accuracy": float(accuracy_score(y_test, predictions)),
        "precision": float(precision_score(y_test, predictions, zero_division=0)),
        "recall": float(recall_score(y_test, predictions, zero_division=0)),
        "f1": float(f1_score(y_test, predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, probabilities)),
        "cv_mean": best_cv_mean,
        "cv_std": best_cv_std,
        "test_size": int(len(y_test)),
    }
    fraction_positive, mean_predicted = calibration_curve(
        y_test, probabilities, n_bins=min(10, max(2, len(y_test) // 20)), strategy="quantile"
    )
    importance = permutation_importance(
        model,
        X_test,
        y_test,
        scoring="roc_auc",
        n_repeats=5,
        random_state=seed,
        n_jobs=-1,
    )
    feature_importances = [
        {"feature": feature, "importance": float(score)}
        for feature, score in sorted(
            zip(features, importance.importances_mean), key=lambda item: item[1], reverse=True
        )
    ]
    numeric_medians = {
        feature: (
            bool(X_train[feature].mode(dropna=True).iloc[0])
            if feature in {"extracurricular", "placement_training"}
            else float(X_train[feature].median())
        )
        for feature in features
    }
    algorithm = type(model.named_steps["classifier"]).__name__
    version_prefix = {
        "LogisticRegression": "lr",
        "RandomForestClassifier": "rf",
        "GradientBoostingClassifier": "gb",
    }[algorithm]
    output = Path(output_dir)
    versions_dir = output / "versions"
    day = datetime.now().strftime('%Y.%m.%d')
    sequence = 1
    while (versions_dir / f"{version_prefix}-{day}-{sequence}").exists():
        sequence += 1
    version = f"{version_prefix}-{day}-{sequence}"
    metadata: dict[str, Any] = {
        "version": version,
        "algorithm": algorithm,
        "features": features,
        "unused_by_model": unused,
        "metrics": metrics,
        "confusion_matrix": confusion_matrix(y_test, predictions, labels=[0, 1]).tolist(),
        "calibration_curve": {
            "mean_predicted_probability": mean_predicted.tolist(),
            "fraction_positive": fraction_positive.tolist(),
        },
        "feature_importances": feature_importances,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_source": detected_source,
        "training_rows": int(len(cleaned)),
        "training_medians": numeric_medians,
        "threshold": 0.5,
        "best_params": best_search.best_params_,
    }
    # Every run is kept under versions/<version>/ so it can be re-activated later;
    # the root model.joblib/metadata.json pair is the active model loaded by Flask.
    version_dir = versions_dir / version
    version_dir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(metadata, indent=2, allow_nan=False)
    joblib.dump(model, version_dir / "model.joblib")
    (version_dir / "metadata.json").write_text(payload, encoding="utf-8")
    if activate:
        joblib.dump(model, output / "model.joblib")
        (output / "metadata.json").write_text(payload, encoding="utf-8")
    return metadata


def register_model(metadata: dict[str, Any]) -> None:
    """Register metadata in Supabase and activate this model using .env credentials."""
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(ROOT / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("--register requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    client = create_client(url, key)
    table = client.table("ml_models")
    table.update({"is_active": False}).eq("is_active", True).execute()
    record = {
        "version": metadata["version"],
        "algorithm": metadata["algorithm"],
        "metrics": metadata["metrics"],
        "feature_list": metadata["features"],
        "trained_at": metadata["trained_at"],
        "is_active": True,
    }
    table.upsert(record, on_conflict="version").execute()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the PlacementAI model from the CLI")
    parser.add_argument("--data", type=Path, help="Optional source CSV; defaults to data/raw/placementdata.csv")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Artifact directory")
    parser.add_argument("--seed", type=int, default=42, help="Split and model random seed")
    parser.add_argument("--register", action="store_true", help="Upsert and activate model in Supabase")
    args = parser.parse_args()
    if args.data:
        raw, source = load_raw(args.data)
        if source == "synthetic":
            raise FileNotFoundError(f"Requested data file does not exist: {args.data}")
        metadata = train_model(raw, dataset_source="kaggle", output_dir=args.output, seed=args.seed)
    else:
        metadata = train_model(output_dir=args.output, seed=args.seed)
    if args.register:
        register_model(metadata)
    print(f"Trained {metadata['algorithm']} ({metadata['version']}) using {metadata['dataset_source']} data")
    print(f"Artifacts: {args.output.resolve()}")
    print(json.dumps(metadata["metrics"], indent=2))


if __name__ == "__main__":
    main()
