#!/usr/bin/env bash

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

AUTOTAG_DIR="$SCRIPT_DIR/autotag"

VENV_DIR="$AUTOTAG_DIR/.venv"
VENV_ACTIVATE_SCRIPT="$VENV_DIR/bin/activate"
VENV_PYTHON_EXE="$VENV_DIR/bin/python"
PYTHON_SCRIPT_TO_RUN="$AUTOTAG_DIR/api.py"

echo "Setting PYTHONPATH to project root: $SCRIPT_DIR"

if [ -n "$PYTHONPATH" ]; then
    export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"
else
    export PYTHONPATH="$SCRIPT_DIR"
fi
echo "PYTHONPATH is now: $PYTHONPATH"
echo

echo "Activating virtual environment from: $VENV_ACTIVATE_SCRIPT"
if [ ! -f "$VENV_ACTIVATE_SCRIPT" ]; then
    echo "ERROR: Virtual environment activation script not found at:" >&2
    echo "$VENV_ACTIVATE_SCRIPT" >&2
    read -r -p "Press Enter to exit."
    exit 1
fi

source "$VENV_ACTIVATE_SCRIPT"

if [ -z "$VIRTUAL_ENV" ]; then
    echo "ERROR: Failed to activate the virtual environment." >&2
    echo "VIRTUAL_ENV variable was not set after sourcing activate script." >&2
    read -r -p "Press Enter to exit."
    exit 1
fi

echo "Virtual environment activated."
echo "VIRTUAL_ENV variable is: $VIRTUAL_ENV"
echo "PATH is now: $PATH"
echo

echo "Running 'which python' to check which python is found first via PATH:"
which python || echo "python not found in PATH (which is unexpected after venv activation)"
echo

echo "Checking for venv Python executable at: \"$VENV_PYTHON_EXE\""
if [ ! -x "$VENV_PYTHON_EXE" ]; then
    echo "ERROR: Virtual environment Python executable NOT FOUND or not executable at:" >&2
    echo "$VENV_PYTHON_EXE" >&2
    echo "Please ensure the virtual environment in '$VENV_DIR' is correctly created" >&2
    echo "and contains 'python' in its 'bin' directory." >&2
    read -r -p "Press Enter to exit."
    exit 1
fi
echo "Virtual environment Python executable confirmed at: \"$VENV_PYTHON_EXE\""
echo

echo "Changing current directory to: $AUTOTAG_DIR"
if ! cd "$AUTOTAG_DIR"; then
    echo "ERROR: Failed to change directory to $AUTOTAG_DIR" >&2
    read -r -p "Press Enter to exit."
    exit 1
fi
echo "Current directory is now: $(pwd)"
echo

echo "Launching Python API server: $PYTHON_SCRIPT_TO_RUN"
if [ ! -f "$PYTHON_SCRIPT_TO_RUN" ]; then
    echo "ERROR: Python script not found at:" >&2
    echo "$PYTHON_SCRIPT_TO_RUN" >&2
    read -r -p "Press Enter to exit."
    exit 1
fi

echo "Starting server using explicitly: \"$VENV_PYTHON_EXE\" \"$PYTHON_SCRIPT_TO_RUN\""
echo "The browser should open automatically by the Python script."
echo "Press Ctrl+C in this window to stop the server."
echo

"$VENV_PYTHON_EXE" "$PYTHON_SCRIPT_TO_RUN"

PYTHON_EXIT_CODE=$?

echo
echo "Python server has stopped (exit code: $PYTHON_EXIT_CODE)."

read -n 1 -s -r -p "Press any key to close this window..."
echo

exit $PYTHON_EXIT_CODE
