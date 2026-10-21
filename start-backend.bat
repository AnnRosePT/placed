@echo off
REM PlacementAI - Flask backend (Windows). First run creates the venv and installs packages.
cd /d "%~dp0backend"
if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv || goto :error
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt || goto :error
) else (
  call .venv\Scripts\activate.bat
)
if not exist ml\artifacts\model.joblib (
  echo Training the placement model on data\raw ...
  python -m ml.train || goto :error
)
python run.py
goto :eof
:error
echo Something failed above. Check that Python 3.11+ is installed and on PATH.
pause
