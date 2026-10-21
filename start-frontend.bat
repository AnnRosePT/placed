@echo off
REM PlacementAI - React frontend (Windows). Requires Node.js 18+.
cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing npm packages...
  call npm install || goto :error
)
call npm run dev
goto :eof
:error
echo npm install failed. Check that Node.js 18+ is installed.
pause
