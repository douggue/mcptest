@echo off
rem First run installs everything; later runs just start the app.
cd /d "%~dp0"
where python >nul 2>nul || (echo Missing: Python. See README. & pause & exit /b 1)
where node >nul 2>nul || (echo Missing: Node.js. See README. & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Missing: ffmpeg. See README. & pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
if not exist web\node_modules (pushd web & call npm install & popd)
if not exist web\dist\index.html (pushd web & call npm run build & popd)
start "" http://127.0.0.1:8000
python run.py --port 8000
pause
