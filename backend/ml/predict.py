"""Inference wrapper for the saved, leakage-safe sklearn pipeline."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

try:
    from .preprocess import BOOL_FEATURES, RANGES
except ImportError:  # pragma: no cover - direct script/module compatibility
    from preprocess import BOOL_FEATURES, RANGES

UI_RANGES: dict[str, tuple[float, float]] = {
    **RANGES,
    "batch_year": (2000, 2100),
}


class PlacementModel:
    """Load and use a trained model; contributions are local explanations."""

    def __init__(self, model: Any, metadata: dict[str, Any], model_dir: Path) -> None:
        self.model_dir = model_dir
        self._model = model
        self.metadata = metadata
        self.features: list[str] = list(metadata["features"])
        self.unused_by_model: list[str] = list(metadata["unused_by_model"])
        self.threshold = float(metadata.get("threshold", 0.5))
        self.training_medians: dict[str, Any] = metadata.get("training_medians", {})

    @classmethod
    def load(cls, model_dir: str | Path) -> "PlacementModel":
        path = Path(model_dir)
        return cls(
            joblib.load(path / "model.joblib"),
            json.loads((path / "metadata.json").read_text(encoding="utf-8")),
            path,
        )

    def _validated_row(self, profile: dict[str, Any]) -> pd.DataFrame:
        if not isinstance(profile, dict):
            raise ValueError("Input must be a student profile dictionary")
        row: dict[str, Any] = {}
        for field, value in profile.items():
            if value is None:
                continue
            if field in BOOL_FEATURES:
                if isinstance(value, str):
                    normalized = value.strip().lower()
                    if normalized in {"yes", "true", "1"}:
                        value = True
                    elif normalized in {"no", "false", "0"}:
                        value = False
                    else:
                        raise ValueError(f"{field} must be a boolean or Yes/No")
                elif not isinstance(value, (bool, np.bool_)):
                    raise ValueError(f"{field} must be a boolean")
                value = int(value)
            elif field in UI_RANGES:
                try:
                    value = float(value)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{field} must be numeric") from exc
                low, high = UI_RANGES[field]
                if not low <= value <= high:
                    raise ValueError(f"{field} must be between {low:g} and {high:g}")
            row[field] = value

        model_row: dict[str, Any] = {}
        for feature in self.features:
            value = row.get(feature)
            if value is None:
                if feature not in self.training_medians:
                    raise ValueError(f"Missing required model feature: {feature}")
                value = self.training_medians[feature]
            if feature in BOOL_FEATURES:
                value = int(value)
            model_row[feature] = value
        return pd.DataFrame([model_row], columns=self.features)

    def _contributions(self, row: pd.DataFrame, probability: float) -> list[dict[str, Any]]:
        classifier = self._model.named_steps["classifier"]
        preprocessor = self._model.named_steps["preprocessor"]
        contributions: list[dict[str, Any]] = []
        transformed = np.asarray(preprocessor.transform(row))[0]
        transformed_names = [
            name.split("__", 1)[-1] for name in preprocessor.get_feature_names_out()
        ]
        transformed_by_feature = dict(zip(transformed_names, transformed))

        if hasattr(classifier, "coef_"):
            coefficients = np.asarray(classifier.coef_)[0]
            for feature, coefficient in zip(transformed_names, coefficients):
                value = row.iloc[0][feature]
                contributions.append(
                    {"feature": feature, "value": value.item() if hasattr(value, "item") else value,
                     "impact": float(coefficient * transformed_by_feature[feature])}
                )
        else:
            for feature in self.features:
                baseline = self.training_medians[feature]
                perturbed = row.copy()
                perturbed.loc[:, feature] = baseline
                baseline_probability = float(self._model.predict_proba(perturbed)[0, 1])
                value = row.iloc[0][feature]
                contributions.append(
                    {"feature": feature,
                     "value": value.item() if hasattr(value, "item") else value,
                     "impact": float(probability - baseline_probability)}
                )
        return sorted(contributions, key=lambda contribution: abs(contribution["impact"]), reverse=True)

    def predict_one(self, profile: dict[str, Any]) -> dict[str, Any]:
        """Predict one profile and return probability, label, and local impacts."""
        row = self._validated_row(profile)
        probability = float(self._model.predict_proba(row)[0, 1])
        return {
            "probability": probability,
            "label": "placed" if probability >= self.threshold else "not_placed",
            "contributions": self._contributions(row, probability),
            "unused_by_model": list(self.unused_by_model),
        }

    def _prepare_frame(self, profiles: pd.DataFrame) -> pd.DataFrame:
        frame = pd.DataFrame(index=profiles.index)
        for feature in self.features:
            column = profiles[feature] if feature in profiles.columns else pd.Series(np.nan, index=profiles.index)
            if feature in BOOL_FEATURES:
                column = column.map(lambda v: np.nan if v is None or (isinstance(v, float) and np.isnan(v))
                                    else int(str(v).strip().lower() in {"1", "true", "yes"}))
            column = pd.to_numeric(column, errors="coerce")
            if feature in UI_RANGES:
                low, high = UI_RANGES[feature]
                column = column.clip(low, high)
            frame[feature] = column.fillna(float(self.training_medians.get(feature, 0)))
        return frame[self.features]

    def predict_frame(self, profiles: pd.DataFrame, explain: bool = True) -> list[dict[str, Any]]:
        """Vectorised batch scoring; contributions via per-feature median substitution."""
        if profiles.empty:
            return []
        frame = self._prepare_frame(profiles)
        probabilities = self._model.predict_proba(frame)[:, 1]
        impacts: dict[str, np.ndarray] = {}
        if explain:
            for feature in self.features:
                perturbed = frame.copy()
                perturbed[feature] = float(self.training_medians.get(feature, 0))
                impacts[feature] = probabilities - self._model.predict_proba(perturbed)[:, 1]
        results = []
        for position, probability in enumerate(probabilities):
            contributions = []
            if explain:
                contributions = sorted(
                    ({"feature": f, "value": float(frame.iloc[position][f]),
                      "impact": float(impacts[f][position])} for f in self.features),
                    key=lambda c: abs(c["impact"]), reverse=True)
            results.append({
                "probability": float(probability),
                "label": "placed" if probability >= self.threshold else "not_placed",
                "contributions": contributions,
            })
        return results

    def predict_batch(self, profiles: pd.DataFrame) -> list[dict[str, Any]]:
        """Predict DataFrame rows in order, including local contributions."""
        if not isinstance(profiles, pd.DataFrame):
            raise ValueError("predict_batch expects a pandas DataFrame")
        return [self.predict_one(profile) for profile in profiles.to_dict(orient="records")]


# Backward-compatible name for early backend code; new callers use PlacementModel.
PlacementPredictor = PlacementModel
