@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "AUTOTAG_DIR=%SCRIPT_DIR%\autotag"

set "VENV_DIR=%AUTOTAG_DIR%\.venv"
set "VENV_ACTIVATE_SCRIPT=%VENV_DIR%\Scripts\activate.bat"
set "VENV_PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "PYTHON_SCRIPT_TO_RUN=%AUTOTAG_DIR%\api.py"

echo Setting PYTHONPATH to project root: %SCRIPT_DIR%
set "PYTHONPATH=%SCRIPT_DIR%;%PYTHONPATH%"
echo PYTHONPATH is now: %PYTHONPATH%
echo.

echo Activating virtual environment from: %VENV_ACTIVATE_SCRIPT%
if not exist "%VENV_ACTIVATE_SCRIPT%" (
    echo ERROR: Virtual environment activation script not found at:
    echo %VENV_ACTIVATE_SCRIPT%
    pause
    exit /b 1
)

call "%VENV_ACTIVATE_SCRIPT%"

if errorlevel 1 (
    echo ERROR: Failed to activate the virtual environment.
    pause
    exit /b 1
)
echo Virtual environment "activated" (activate.bat was called).
echo VIRTUAL_ENV variable is: %VIRTUAL_ENV%
echo PATH is now: %PATH%
echo.
echo Running 'where python' to check which python is found first via PATH:
where python
echo.

echo Checking for venv Python executable at: "%VENV_PYTHON_EXE%"
if not exist "%VENV_PYTHON_EXE%" (
    echo ERROR: Virtual environment Python executable NOT FOUND at:
    echo %VENV_PYTHON_EXE%
    echo Please ensure the virtual environment in '%VENV_DIR%' is correctly created
    echo and contains 'python.exe' in its 'Scripts' directory.
    pause
    exit /b 1
)
echo Virtual environment Python executable confirmed at: "%VENV_PYTHON_EXE%"
echo.

echo Changing current directory to: %AUTOTAG_DIR%
cd /d "%AUTOTAG_DIR%"
if errorlevel 1 (
    echo ERROR: Failed to change directory to %AUTOTAG_DIR%
    pause
    exit /b 1
)
echo Current directory is now: %CD%
echo.

echo Launching Python API server: %PYTHON_SCRIPT_TO_RUN%
if not exist "%PYTHON_SCRIPT_TO_RUN%" (
    echo ERROR: Python script not found at:
    echo %PYTHON_SCRIPT_TO_RUN%
    pause
    exit /b 1
)

echo Starting server using explicitly: "%VENV_PYTHON_EXE%" "%PYTHON_SCRIPT_TO_RUN%"
echo The browser should open automatically by the Python script.
echo Press Ctrl+C in this window to stop the server.
echo.

"%VENV_PYTHON_EXE%" "%PYTHON_SCRIPT_TO_RUN%"

echo.
echo Python server has stopped.

echo Press any key to close this window.
pause
endlocal