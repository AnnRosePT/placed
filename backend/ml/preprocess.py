"""Load, clean, and transform placement data without target leakage."""
from __future__ import annotations

import re
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:  # Support both ``python backend/ml/train.py`` and package imports.
    from .generate_synthetic import generate_synthetic
except ImportError:  # pragma: no cover - exercised by direct CLI execution
    from generate_synthetic import generate_synthetic

ROOT = Path(__file__).resolve().parents[2]
RAW_DATA_PATH = ROOT / "data" / "raw" / "placementdata.csv"
# Kaggle mirrors ship the same file as placementdata.csv or placements.csv.
RAW_DATA_CANDIDATES = [RAW_DATA_PATH, ROOT / "data" / "raw" / "placements.csv"]
FEATURE_CANDIDATES = [
    "tenth_pct",
    "twelfth_pct",
    "cgpa",
    "aptitude_score",
    "technical_score",
    "communication_score",
    "internships",
    "projects",
    "certifications",
    "backlogs",
    "extracurricular",
    "placement_training",
]
BOOL_FEATURES = {"extracurricular", "placement_training"}
RANGES: dict[str, tuple[float, float]] = {
    "tenth_pct": (0, 100),
    "twelfth_pct": (0, 100),
    "cgpa": (0, 10),
    "aptitude_score": (0, 100),
    "technical_score": (0, 100),
    "communication_score": (0, 100),
    "internships": (0, 20),
    "projects": (0, 100),
    "certifications": (0, 100),
    "backlogs": (0, 20),
}
FEATURES: list[str] = []
UNUSED_BY_MODEL: list[str] = []

_COLUMN_ALIASES: dict[str, str] = {
    "studentid": "usn",
    "usn": "usn",
    "fullname": "full_name",
    "email": "email",
    "department": "department",
    "batchyear": "batch_year",
    "sscmarks": "tenth_pct",
    "tenthpct": "tenth_pct",
    "hscmarks": "twelfth_pct",
    "twelfthpct": "twelfth_pct",
    "cgpa": "cgpa",
    "aptitudetestscore": "aptitude_score",
    "aptitudescore": "aptitude_score",
    "technical_score": "technical_score",
    "technicalscore": "technical_score",
    "softskillsrating": "communication_score",
    "communicationscore": "communication_score",
    "internships": "internships",
    "projects": "projects",
    "workshops_certifications": "certifications",
    "workshopscertifications": "certifications",
    "certifications": "certifications",
    "backlogs": "backlogs",
    "extracurricularactivities": "extracurricular",
    "extracurricular": "extracurricular",
    "placementtraining": "placement_training",
    "placement_training": "placement_training",
    "placementstatus": "placement_status",
    "placement_status": "placement_status",
    "company": "company",
    "packagelpa": "package_lpa",
    "package_lpa": "package_lpa",
}


def _normalise_header(name: Any) -> str:
    """Normalise a source header for alias lookup."""
    return re.sub(r"[^a-z0-9]", "", str(name).strip().lower())


def load_raw(path: str | Path | None = None) -> tuple[pd.DataFrame, str]:
    """Load the Kaggle CSV or warn and return a seeded synthetic fallback."""
    if path is not None:
        source_path = Path(path)
    else:
        source_path = next((c for c in RAW_DATA_CANDIDATES if c.is_file()), RAW_DATA_PATH)
    if source_path.is_file():
        return pd.read_csv(source_path), "kaggle"
    warnings.warn(
        f"Dataset not found at {source_path}; using 5,000 seeded synthetic rows. "
        "Synthetic data is illustrative only and must not be presented as real outcomes.",
        RuntimeWarning,
        stacklevel=2,
    )
    return generate_synthetic(n_rows=5_000, random_state=42), "synthetic"


def _map_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename: dict[Any, str] = {}
    for column in df.columns:
        normalised = _normalise_header(column)
        target = _COLUMN_ALIASES.get(normalised) or _COLUMN_ALIASES.get(
            str(column).strip().lower()
        )
        if target:
            rename[column] = target
    return df.rename(columns=rename).copy()


def _to_bool(series: pd.Series) -> pd.Series:
    mapping = {
        "yes": True,
        "y": True,
        "true": True,
        "1": True,
        "no": False,
        "n": False,
        "false": False,
        "0": False,
    }
    return series.map(
        lambda value: mapping.get(str(value).strip().lower())
        if pd.notna(value)
        else np.nan
    ).astype("boolean")


def _target_from_status(series: pd.Series) -> pd.Series:
    status = series.astype("string").str.strip().str.lower().str.replace(
        r"[ _-]+", "", regex=True
    )
    positive = {"placed", "yes", "1", "true"}
    negative = {"notplaced", "no", "0", "false"}
    mapped = status.map(lambda value: 1 if value in positive else 0 if value in negative else np.nan)
    if mapped.isna().any():
        unknown = sorted(status[mapped.isna()].dropna().unique().tolist())
        raise ValueError(f"Unrecognized PlacementStatus values: {unknown}")
    return mapped.astype("int8")


def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    """Map source fields, clean rows, and add binary ``target``.

    Updates module-level ``FEATURES`` and ``UNUSED_BY_MODEL`` from the actual
    training columns so the same availability information can be serialized.
    """
    global FEATURES, UNUSED_BY_MODEL
    mapped = _map_columns(df)
    if "target" in mapped.columns:
        target = pd.to_numeric(mapped["target"], errors="coerce")
    elif "placement_status" in mapped.columns:
        target = _target_from_status(mapped["placement_status"])
    else:
        raise ValueError("Training data must include PlacementStatus or target")

    mapped["target"] = target
    if "communication_score" in mapped.columns:
        # Kaggle SoftSkillsRating is documented on a 0–5 scale. Canonical
        # communication_score inputs already use the shared 0–100 scale.
        original_name = next(
            (str(col) for col in df.columns if _COLUMN_ALIASES.get(_normalise_header(col)) == "communication_score"),
            "",
        )
        if _normalise_header(original_name) == "softskillsrating":
            mapped["communication_score"] = pd.to_numeric(
                mapped["communication_score"], errors="coerce"
            ) * 20

    for column in BOOL_FEATURES.intersection(mapped.columns):
        # Keep these unscaled and passthrough in the ColumnTransformer while
        # using numeric 0/1 so sklearn's most_frequent imputer supports them.
        mapped[column] = _to_bool(mapped[column]).astype("float64")
    for column in FEATURE_CANDIDATES:
        if column in mapped.columns and column not in BOOL_FEATURES:
            mapped[column] = pd.to_numeric(mapped[column], errors="coerce")
            low, high = RANGES[column]
            mapped[column] = mapped[column].clip(low, high)

    mapped = mapped.dropna(subset=["target"])
    if "usn" in mapped.columns:
        mapped = mapped.drop_duplicates(subset=["usn"], keep="first")
    else:
        mapped = mapped.drop_duplicates()
    mapped["target"] = mapped["target"].astype("int8")
    mapped = mapped.drop(
        columns=["placement_status", "company", "package_lpa"], errors="ignore"
    )
    FEATURES = [name for name in FEATURE_CANDIDATES if name in mapped.columns]
    UNUSED_BY_MODEL = [name for name in FEATURE_CANDIDATES if name not in FEATURES]
    if not FEATURES:
        raise ValueError("No supported model feature columns were found in training data")
    if mapped["target"].nunique() < 2:
        raise ValueError("Training data must contain both placed and not-placed outcomes")
    return mapped.reset_index(drop=True)


def build_preprocessor(features: list[str]) -> ColumnTransformer:
    """Create the fitted-at-training preprocessing transformer."""
    numeric = [feature for feature in features if feature not in BOOL_FEATURES]
    boolean = [feature for feature in features if feature in BOOL_FEATURES]
    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric:
        numeric_pipeline = Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
            ]
        )
        transformers.append(("numeric", numeric_pipeline, numeric))
    if boolean:
        boolean_pipeline = Pipeline(
            [("imputer", SimpleImputer(strategy="most_frequent"))]
        )
        transformers.append(("boolean", boolean_pipeline, boolean))
    return ColumnTransformer(transformers=transformers, remainder="drop")
