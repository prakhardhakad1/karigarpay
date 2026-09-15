@echo off
setlocal
title KarigarPay
set "WB_PY=%USERPROFILE%\.workbuddy-ai\binaries\python\versions\3.13.12\python.exe"
if exist "%WB_PY%" goto managed
where py >nul 2>&1
if not errorlevel 1 goto launcher
where python >nul 2>&1
if not errorlevel 1 goto python
echo Python 3.11 or newer is required. Install Python and run this file again.
exit /b 1
:managed
"%WB_PY%" "%~dp0bootstrap.py" %*
exit /b %errorlevel%
:launcher
py -3 "%~dp0bootstrap.py" %*
exit /b %errorlevel%
:python
python "%~dp0bootstrap.py" %*
exit /b %errorlevel%
