# Dataset guide

## Source and placement

The expected source is Kaggle's **Placement Prediction Dataset**, distributed as
`placementdata.csv`. Download it from Kaggle and place the unmodified file at
`data/raw/placementdata.csv` (a copy named `data/raw/placements.csv` is also detected — that is the file
included in this repo). The ML loader uses a deterministic synthetic dataset if that
file is absent; it prints a warning when it does so. Do not rename or hand-edit the source.

Kaggle dataset licenses and redistribution terms can vary by uploader and dataset revision.
Check the license shown on the exact Kaggle dataset page before downloading, using,
redistributing, or publishing the data. This repository does not assert ownership or grant a
license to the source data. Keep personal data out of commits.

## Raw column dictionary and model mapping

The commonly distributed CSV has these columns. `preprocess.py` inspects the actual header,
uses only recognized columns that are present, and records unavailable model fields as
`unused_by_model` in model metadata.

| Raw column | Meaning | Shared field / handling |
|---|---|---|
| `StudentID` | Source row/student identifier | `usn` (string form; excluded from model features) |
| `CGPA` | Grade-point average, usually 0–10 | `cgpa` |
| `Internships` | Internship count | `internships` |
| `Projects` | Project count | `projects` |
| `Workshops/Certifications` | Workshop/certification count | `certifications` |
| `AptitudeTestScore` | Aptitude test score, usually 0–100 | `aptitude_score` |
| `SoftSkillsRating` | Soft-skills rating, usually 0–5 | `communication_score` (rating multiplied by 20) |
| `ExtracurricularActivities` | Participation indicator | `extracurricular` (Yes/No to boolean) |
| `PlacementTraining` | Training participation indicator | `placement_training` (Yes/No to boolean) |
| `SSC_Marks` | Secondary-school marks, percent | `tenth_pct` |
| `HSC_Marks` | Higher-secondary marks, percent | `twelfth_pct` |
| `PlacementStatus` | Placement outcome | `placement_status`, then binary target `target` (Placed=1, NotPlaced=0) |

Fields such as `technical_score`, `backlogs`, `department`, `batch_year`, `company`, and
`package_lpa` are not in this source. They must not be fabricated as observed Kaggle inputs;
missing model candidates appear in `unused_by_model`. Outcome/status, company, and package
fields are excluded from model features to prevent target leakage.

## Data handling

- `raw/` is immutable; all mapping, deduplication, clipping, and imputation belongs in
	`backend/ml/preprocess.py`.
- `processed/` is reserved for reproducible derived data; it is not a source of truth.
- The synthetic fallback is illustrative only and is not a replacement for licensed,
	representative institutional outcomes.
