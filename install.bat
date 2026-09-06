@echo off
REM ===========================================================================
REM  axis-cli installer for Windows
REM  Double-click this file, or run it from cmd / PowerShell.
REM
REM  Installs the `axis` command globally so it is available in any terminal,
REM  permanently, across reboots. Camera profiles live in
REM  %USERPROFILE%\.axis-cli\config.json and are never touched by this script.
REM ===========================================================================

setlocal EnableDelayedExpansion

REM Always work from the folder this script lives in.
cd /d "%~dp0"
set "PROJECT_DIR=%CD%"

echo ----------------------------------------------
echo   axis-cli installer (Windows)
echo ----------------------------------------------
echo.
echo Project: %PROJECT_DIR%
echo.

REM --- 1. Sanity check -------------------------------------------------------
if not exist "package.json" (
    echo [FAIL] package.json not found here.
    echo        Keep install.bat inside the axis-cli project folder.
    goto :fail
)

REM --- 2. Check Node.js ------------------------------------------------------
echo ==^> Checking Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Node.js is not installed, or not on PATH.
    echo.
    echo        Install it with winget:
    echo            winget install OpenJS.NodeJS.LTS
    echo.
    echo        Or download the LTS installer from https://nodejs.org
    echo.
    echo        After installing, CLOSE this window and run install.bat again
    echo        so the new PATH takes effect.
    goto :fail
)

for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
for /f "delims=" %%p in ('where node') do (
    if not defined NODE_BIN set "NODE_BIN=%%p"
)

REM Strip the leading "v" and take the major version.
set "NODE_NUM=!NODE_VER:v=!"
for /f "tokens=1 delims=." %%m in ("!NODE_NUM!") do set "NODE_MAJOR=%%m"

if !NODE_MAJOR! LSS 18 (
    echo [FAIL] Node !NODE_VER! found, but axis-cli requires Node 18 or newer.
    echo        Upgrade with: winget upgrade OpenJS.NodeJS.LTS
    goto :fail
)
echo   ok  Node !NODE_VER!  ^(!NODE_BIN!^)

where npm >nul 2>&1
if errorlevel 1 (
    echo [FAIL] npm not found alongside Node. Reinstall Node.js.
    goto :fail
)
for /f "delims=" %%v in ('npm -v') do set "NPM_VER=%%v"
echo   ok  npm !NPM_VER!

REM Warn if the project is on a removable / network drive.
set "DRIVE=%PROJECT_DIR:~0,1%"
if /i not "%DRIVE%"=="C" (
    echo.
    echo [warn] Project is on drive %DRIVE%: ^(external or network^).
    echo        That's fine: "npm install -g ." copies the built files into
    echo        Node's global folder, so "axis" keeps working when the drive
    echo        is disconnected. ^(This is why we don't use "npm link".^)
)
if "%PROJECT_DIR:~0,2%"=="\\" (
    echo.
    echo [warn] Project is on a UNC network path. npm can misbehave here.
    echo        Consider copying the folder to a local drive first.
)

REM --- 3. Install dependencies ----------------------------------------------
echo.
echo ==^> Installing dependencies
if exist "package-lock.json" (
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        echo [warn] npm ci failed; falling back to npm install
        call npm install --no-audit --no-fund
        if errorlevel 1 (
            echo [FAIL] Could not install dependencies.
            goto :fail
        )
    )
) else (
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [FAIL] Could not install dependencies.
        goto :fail
    )
)
echo   ok  Dependencies ready

REM --- 4. Build --------------------------------------------------------------
echo.
echo ==^> Building TypeScript
call npm run build
if errorlevel 1 (
    echo [FAIL] Build failed. Scroll up for the TypeScript errors.
    goto :fail
)
if not exist "dist\index.js" (
    echo [FAIL] Build produced no dist\index.js.
    goto :fail
)
echo   ok  Built dist\index.js

REM --- 5. Global install ----------------------------------------------------
echo.
echo ==^> Installing 'axis' globally
call npm install -g .
if errorlevel 1 (
    echo [FAIL] Global install failed.
    echo.
    echo        If you see EPERM or EACCES, right-click install.bat and pick
    echo        "Run as administrator", then try again.
    goto :fail
)

REM --- 6. Verify ------------------------------------------------------------
echo.
echo ==^> Verifying
where axis >nul 2>&1
if errorlevel 1 (
    echo [FAIL] 'axis' installed but is not on your PATH in this window.
    echo.
    for /f "delims=" %%g in ('npm prefix -g') do set "NPM_PREFIX=%%g"
    echo        npm's global folder is: !NPM_PREFIX!
    echo        Open a NEW terminal and run 'axis --version'. If it still
    echo        fails, add that folder to your PATH environment variable.
    goto :fail
)

for /f "delims=" %%p in ('where axis') do (
    if not defined AXIS_PATH set "AXIS_PATH=%%p"
)
for /f "delims=" %%v in ('axis --version 2^>nul') do set "AXIS_VER=%%v"
if not defined AXIS_VER set "AXIS_VER=?"
echo   ok  axis !AXIS_VER!  ^(!AXIS_PATH!^)

REM --- 7. Next steps --------------------------------------------------------
echo.
echo Next steps
echo.
if exist "%USERPROFILE%\.axis-cli\config.json" (
    echo   ok  Existing camera profiles found at %%USERPROFILE%%\.axis-cli\config.json
    echo.
    echo     axis camera list        ^# your saved cameras
    echo     axis fleet health       ^# check them all
) else (
    echo   1. Don't know your camera's IP? Scan for it:
    echo.
    echo          axis discovery
    echo          axis discovery --add    ^# scan and save interactively in one step
    echo.
    echo   2. Or save it directly ^(omit --pass and it prompts, without echo^):
    echo.
    echo          axis camera add q1656 --ip 192.168.1.50 --user root
    echo.
    echo   3. Check it answers:
    echo.
    echo          axis camera test q1656
    echo          axis info q1656
)
echo.
echo     axis --help             ^# all commands
echo.
echo Profiles are stored in %%USERPROFILE%%\.axis-cli\config.json and survive reboots.
echo To uninstall:  npm uninstall -g axis-cli
echo.
echo ==============================
echo   Install complete.
echo ==============================
echo.
pause
endlocal
exit /b 0

:fail
echo.
echo ==============================
echo   Install failed.
echo ==============================
echo.
pause
endlocal
exit /b 1
