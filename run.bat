@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "AUTOTAG_DIR=%SCRIPT_DIR%\autotag"
set "REQUIREMENTS_FILE=%AUTOTAG_DIR%\requirements.txt"

set "VENV_DIR=%AUTOTAG_DIR%\.venv"
set "VENV_ACTIVATE_SCRIPT=%VENV_DIR%\Scripts\activate.bat"
set "VENV_PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "PYTHON_SCRIPT_TO_RUN=%AUTOTAG_DIR%\api.py"

echo Setting PYTHONPATH to project root: %SCRIPT_DIR%
set "PYTHONPATH=%SCRIPT_DIR%;%PYTHONPATH%"
echo PYTHONPATH is now: %PYTHONPATH%
echo.

echo DEBUG: Value of VENV_ACTIVATE_SCRIPT is [%VENV_ACTIVATE_SCRIPT%]
echo DEBUG: About to check existence of the above path.

if not exist "%VENV_ACTIVATE_SCRIPT%" (
  echo Virtual environment activation script not found at: %VENV_ACTIVATE_SCRIPT%
  echo Attempting to create virtual environment and install requirements...
  echo.
  
  if not exist "%AUTOTAG_DIR%\" (
    echo WARNING: AUTOTAG_DIR does not exist: %AUTOTAG_DIR%
    echo Attempting to create it...
    mkdir "%AUTOTAG_DIR%"
    if errorlevel 1 (
      echo ERROR: Failed to create AUTOTAG_DIR: %AUTOTAG_DIR%
      pause
      exit /b 1
    )
    if not exist "%AUTOTAG_DIR%\" (
      echo ERROR: Failed to create AUTOTAG_DIR (still not found): %AUTOTAG_DIR%
      pause
      exit /b 1
    )
    echo AUTOTAG_DIR created.
    echo.
  )
  
  if not exist "%REQUIREMENTS_FILE%" (
    echo ERROR: requirements.txt not found at: %REQUIREMENTS_FILE%
    echo Cannot create virtual environment without requirements.
    pause
    exit /b 1
  )
  
  echo Looking for a suitable Python interpreter (Python 3.3+ with venv module)...
  python -m venv --help >nul 2>nul
  if errorlevel 1 (
    echo ERROR: 'python -m venv' command failed or Python was not found.
    echo Please ensure Python 3.3+ (with the 'venv' module) is installed and in your PATH.
    pause
    exit /b 1
  )
  echo Found suitable Python for creating venv.
  echo.
  
  echo Creating virtual environment at: %VENV_DIR%
  python -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo ERROR: Failed to create virtual environment at %VENV_DIR%
    pause
    exit /b 1
  )
  echo Virtual environment created successfully.
  echo.
  
  echo Activating new virtual environment to install requirements...
  if not exist "%VENV_ACTIVATE_SCRIPT%" (
    echo ERROR: New virtual environment activation script still not found after creation!
    echo Path: %VENV_ACTIVATE_SCRIPT%
    pause
    exit /b 1
  )
  call "%VENV_ACTIVATE_SCRIPT%"
  if errorlevel 1 (
    echo ERROR: Failed to activate the newly created virtual environment.
    pause
    exit /b 1
  )
  echo New virtual environment "activated" (activate.bat was called).
  if defined VIRTUAL_ENV (
    echo VIRTUAL_ENV variable is: %VIRTUAL_ENV%
    ) else (
    echo WARNING: VIRTUAL_ENV variable not set after activation.
  )
  echo PATH is now: %PATH%
  echo.
  
  echo Installing requirements from: %REQUIREMENTS_FILE%
  if not exist "%VENV_PYTHON_EXE%" (
    echo ERROR: Python executable not found in new venv: %VENV_PYTHON_EXE%
    echo This is unexpected after venv creation and activation.
    pause
    exit /b 1
  )
  "%VENV_PYTHON_EXE%" -m pip install -r "%REQUIREMENTS_FILE%"
  if errorlevel 1 (
    echo ERROR: Failed to install requirements from %REQUIREMENTS_FILE%
    echo You may need to manually troubleshoot or remove the "%VENV_DIR%" directory and try again.
    pause
    exit /b 1
  )
  echo Requirements installed successfully.
  echo.
  
) else (
  echo Activating existing virtual environment from: %VENV_ACTIVATE_SCRIPT%
  call "%VENV_ACTIVATE_SCRIPT%"
  if errorlevel 1 (
    echo ERROR: Failed to activate the existing virtual environment.
    pause
    exit /b 1
  )
  echo Virtual environment "activated" (activate.bat was called).
  if defined VIRTUAL_ENV (
    echo VIRTUAL_ENV variable is: %VIRTUAL_ENV%
    ) else (
    echo WARNING: VIRTUAL_ENV variable not set after activation.
  )
  echo PATH is now: %PATH%
  echo.
)

echo Running 'where python' to check which python is found first via PATH:
where python
echo.

echo Checking for venv Python executable at: "%VENV_PYTHON_EXE%"
if not exist "%VENV_PYTHON_EXE%" (
  echo ERROR: Virtual environment Python executable NOT FOUND at:
  echo %VENV_PYTHON_EXE%
  echo This can happen if venv creation or activation failed unexpectedly.
  echo Please ensure the virtual environment in '%VENV_DIR%' is correctly created
  echo and contains 'python.exe' in its 'Scripts' directory.
  pause
  exit /b 1
)
echo Virtual environment Python executable confirmed at: "%VENV_PYTHON_EXE%"
echo.

echo Changing current directory to: %AUTOTAG_DIR%
if not exist "%AUTOTAG_DIR%\" (
  echo ERROR: Target directory %AUTOTAG_DIR% does not exist.
  pause
  exit /b 1
)
cd /d "%AUTOTAG_DIR%"
if errorlevel 1 (
  echo ERROR: Failed to change directory to %AUTOTAG_DIR%
  pause
  exit /b 1
)
echo Current directory is now: %CD%
echo.

echo Launching Python API server: %PYTHON_SCRIPT_TO_RUN%
for %%F in ("%PYTHON_SCRIPT_TO_RUN%") do set "PYTHON_SCRIPT_FILENAME=%%~nxF"

if not exist "%PYTHON_SCRIPT_FILENAME%" (
  echo ERROR: Python script "%PYTHON_SCRIPT_FILENAME%" not found in current directory (%CD%).
  echo Expected at full path: %PYTHON_SCRIPT_TO_RUN%
  pause
  exit /b 1
)

echo Starting server using explicitly: "%VENV_PYTHON_EXE%" "%PYTHON_SCRIPT_FILENAME%"
echo The browser should open automatically by the Python script.
echo Press Ctrl+C in this window to stop the server.
echo.

"%VENV_PYTHON_EXE%" "%PYTHON_SCRIPT_FILENAME%"
set "PYTHON_EXIT_CODE=%errorlevel%"

echo.
echo Python server has stopped (exit code: %PYTHON_EXIT_CODE%).

echo Press any key to close this window.
pause
endlocal
exit /b %PYTHON_EXIT_CODE%