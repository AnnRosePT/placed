#!/usr/bin/env bash
# PlacementAI - start backend + frontend (macOS/Linux)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
[ -d .venv ] || { python3 -m venv .venv; . .venv/bin/activate; pip install -r requirements.txt; }
. .venv/bin/activate
[ -f ml/artifacts/model.joblib ] || python -m ml.train
python run.py &
BACK=$!
cd "$ROOT/frontend"
[ -d node_modules ] || npm install
trap "kill $BACK" EXIT
npm run dev
