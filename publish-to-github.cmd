@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: publish-to-github.cmd https://github.com/YOUR_NAME/pianopath.git
  echo.
  echo Create an empty repository on GitHub first, then pass its URL.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Install Git first: https://git-scm.com/download/win
  pause
  exit /b 1
)
git remote remove origin >nul 2>nul
git remote add origin "%~1"
git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. Check GitHub authentication and the repository URL.
  pause
  exit /b 1
)
echo.
echo Published. Open GitHub Settings - Pages and choose GitHub Actions.
pause
