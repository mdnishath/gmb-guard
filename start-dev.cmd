@echo off
REM One-click local start: installs deps if needed, starts the Next.js dev server,
REM then opens the app in the browser. The SQLite database is created automatically.
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)

echo Starting GMB Guard...
start "GMB Guard - App" cmd /k "npm run dev"

echo Waiting for app to compile...
timeout /t 20 /nobreak >nul

start http://localhost:3000
echo.
echo App: http://localhost:3000
echo Keep the console window open while testing.
