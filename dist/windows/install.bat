@echo off
echo ============================================
echo   VP-Overwatch Installer
echo ============================================
echo.
echo Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download from https://nodejs.org
    pause
    exit /b 1
)
echo Node.js found.
echo.
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo.
echo Building application...
npx next build
if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)
echo.
echo ============================================
echo   Installation complete!
echo   Run start.bat to launch VP-Overwatch
echo ============================================
pause
