@echo off
setlocal
title Cutroom
rem First run installs everything (several minutes); later runs just start the app.
cd /d "%~dp0"

echo.
echo  Cutroom
echo  =======
echo.

rem ---- the three programs Cutroom needs ------------------------------------
rem "where python" is not enough: Windows has a fake python that only opens the Microsoft Store,
rem so ask Python itself for its version.
set "PY="
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=python"
if not defined PY py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY (
  echo  [!] Python 3.10 or newer was not found.
  echo      Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH" in the installer.
  echo      If you already did: Windows Settings ^> Apps ^> Advanced app settings ^> App execution aliases,
  echo      and turn OFF "App Installer python.exe" and "python3.exe".
  goto fail
)
for /f "delims=" %%v in ('%PY% -c "import platform; print(platform.python_version())"') do echo  Python %%v found.

where node >nul 2>nul || (
  echo  [!] Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  goto fail
)
for /f "delims=" %%v in ('node --version') do echo  Node.js %%v found.

where ffmpeg >nul 2>nul || (
  echo  [!] ffmpeg was not found. The easiest way: open a terminal and run   winget install Gyan.FFmpeg
  echo      then close this window and run start.bat again.
  goto fail
)
echo  ffmpeg found.
echo.

rem ---- where things go --------------------------------------------------------
rem OneDrive (and Dropbox) lock each new file while they upload it, which breaks installing thousands of small
rem files ("WinError 32 ... being used by another process"), and would upload every video Cutroom imports.
rem Inside such a folder, the Python environment and the videos live in folders that are not synced.
set "ENVDIR=.venv"
echo "%~dp0" | findstr /i /c:"\OneDrive" /c:"\Dropbox" >nul && (
  set "ENVDIR=%LOCALAPPDATA%\Cutroom\venv"
  if not defined CUTROOM_DATA set "CUTROOM_DATA=%USERPROFILE%\CutroomData"
  echo  [i] This folder is synced by OneDrive or Dropbox, which gets in the way of installing and would upload
  echo      every video. So Cutroom keeps its Python environment in %LOCALAPPDATA%\Cutroom\venv
  echo      and your videos and projects in %USERPROFILE%\CutroomData.
  echo      Simpler: move this whole folder somewhere not synced, such as C:\Cutroom, and run start.bat there.
  echo.
)

rem ---- first run: install ----------------------------------------------------
if not exist "%ENVDIR%\Scripts\python.exe" (
  echo  [1/4] Creating a private Python environment ^(first run only^)...
  %PY% -m venv "%ENVDIR%" || goto fail
)
set "VPY=%ENVDIR%\Scripts\python.exe"

if not exist "%ENVDIR%\installed.txt" (
  echo  [2/4] Installing the Python packages. This downloads a few hundred MB and can take 5-15 minutes.
  echo        You will see the progress below; it is working even when it pauses.
  echo.
  "%VPY%" -m pip install --upgrade pip || goto fail
  "%VPY%" -m pip install -r requirements.txt || goto fail
  echo.
  echo  Optional features ^(each one installs on its own; a failure only switches that feature off^):
  for /f "usebackq eol=# tokens=1" %%p in ("requirements-optional.txt") do (
    echo    - %%p
    "%VPY%" -m pip install "%%p" >nul 2>nul || echo      [!] Could not install %%p; that feature stays off. Cutroom works without it.
  )
  echo done> "%ENVDIR%\installed.txt"
) else (
  echo  [2/4] Python packages already installed.
)

if not exist web\node_modules (
  echo.
  echo  [3/4] Installing the interface ^(first run only, a few minutes^)...
  pushd web
  call npm install || (popd & goto fail)
  popd
) else (
  echo  [3/4] Interface packages already installed.
)

if not exist web\dist\index.html (
  echo.
  echo  [4/4] Building the interface...
  pushd web
  call npm run build || (popd & goto fail)
  popd
) else (
  echo  [4/4] Interface already built.
)

rem ---- start ------------------------------------------------------------------
echo.
echo  Starting Cutroom. Your browser opens at http://127.0.0.1:8000
echo  Keep this window open while you use Cutroom; close it to stop.
echo.
"%VPY%" run.py --open --port 8000
echo.
echo  Cutroom stopped.
pause
exit /b 0

:fail
echo.
echo  Setup stopped because of the problem above. Fix it, then double-click start.bat again.
echo  (If you cannot tell what went wrong, copy everything in this window and send it to me.)
echo.
pause
exit /b 1
