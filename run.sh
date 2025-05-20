#!/usr/bin/env bash

set -e

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

AUTOTAG_DIR="$SCRIPT_DIR/autotag"
REQUIREMENTS_FILE="$AUTOTAG_DIR/requirements.txt"

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

if [ ! -f "$VENV_ACTIVATE_SCRIPT" ]; then
    echo "Virtual environment activation script not found at: $VENV_ACTIVATE_SCRIPT"
    echo "Attempting to create virtual environment and install requirements..."
    echo

    if [ ! -f "$REQUIREMENTS_FILE" ]; then
        echo "ERROR: requirements.txt not found at: $REQUIREMENTS_FILE" >&2
        echo "Cannot create virtual environment without requirements." >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi

    PYTHON_INTERPRETER_FOR_VENV=""
    if command -v python3 &>/dev/null; then
        PYTHON_INTERPRETER_FOR_VENV="python3"
    elif command -v python &>/dev/null; then

        if python -c 'import sys; exit(0 if sys.version_info.major == 3 and sys.version_info.minor >= 3 else 1)' &>/dev/null; then
            PYTHON_INTERPRETER_FOR_VENV="python"
        else
            echo "Found 'python' but it's not Python 3.3+. Trying 'python3' failed." >&2
        fi
    fi

    if [ -z "$PYTHON_INTERPRETER_FOR_VENV" ]; then
        echo "ERROR: Suitable Python 3 (3.3+) interpreter (python3 or python) not found." >&2
        echo "The 'venv' module requires Python 3.3+." >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi
    echo "Using '$PYTHON_INTERPRETER_FOR_VENV' to create virtual environment."
    echo

    if [ ! -d "$AUTOTAG_DIR" ]; then
        echo "Project directory for 'autotag' not found at: $AUTOTAG_DIR"
        echo "Attempting to create it..."
        if ! mkdir -p "$AUTOTAG_DIR"; then
            echo "ERROR: Failed to create AUTOTAG_DIR: $AUTOTAG_DIR" >&2
            read -r -p "Press Enter to exit."
            exit 1
        fi
        echo "'$AUTOTAG_DIR' created."
        echo
    fi

    echo "Creating virtual environment at: $VENV_DIR"
    if ! "$PYTHON_INTERPRETER_FOR_VENV" -m venv "$VENV_DIR"; then
        echo "ERROR: Failed to create virtual environment at $VENV_DIR" >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi
    echo "Virtual environment created successfully."
    echo

    echo "Activating new virtual environment to install requirements..."

    source "$VENV_ACTIVATE_SCRIPT"
    if [ -z "$VIRTUAL_ENV" ]; then
        echo "ERROR: Failed to activate the newly created virtual environment." >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi
    echo "New virtual environment activated."
    echo "VIRTUAL_ENV is: $VIRTUAL_ENV"
    echo "PATH is now: $PATH"
    echo

    echo "Installing requirements from: $REQUIREMENTS_FILE"

    if ! python -m pip install -r "$REQUIREMENTS_FILE"; then
        echo "ERROR: Failed to install requirements from $REQUIREMENTS_FILE" >&2
        echo "You may need to manually troubleshoot or remove the '$VENV_DIR' directory and try again." >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi
    echo "Requirements installed successfully."
    echo

else
    echo "Activating existing virtual environment from: $VENV_ACTIVATE_SCRIPT"

    source "$VENV_ACTIVATE_SCRIPT"
    if [ -z "$VIRTUAL_ENV" ]; then
        echo "ERROR: Failed to activate the existing virtual environment." >&2
        read -r -p "Press Enter to exit."
        exit 1
    fi
    echo "Virtual environment activated."
    echo "VIRTUAL_ENV variable is: $VIRTUAL_ENV"
    echo "PATH is now: $PATH"
    echo
fi

echo "Running 'which python' to check which python is found first via PATH:"
which python || echo "python not found in PATH (this is unexpected after venv activation)"
echo

echo "Checking for venv Python executable at: \"$VENV_PYTHON_EXE\""

if [ ! -x "$VENV_PYTHON_EXE" ]; then
    echo "ERROR: Virtual environment Python executable NOT FOUND or not executable at:" >&2
    echo "$VENV_PYTHON_EXE" >&2
    echo "This can happen if the venv creation or activation failed unexpectedly." >&2
    echo "Please ensure the virtual environment in '$VENV_DIR' is correctly created" >&2
    echo "and contains an executable 'python' in its 'bin' directory." >&2
    read -r -p "Press Enter to exit."
    exit 1
fi
echo "Virtual environment Python executable confirmed at: \"$VENV_PYTHON_EXE\""
echo

echo "Changing current directory to: $AUTOTAG_DIR"
if [ ! -d "$AUTOTAG_DIR" ]; then
    echo "ERROR: Target directory $AUTOTAG_DIR does not exist." >&2
    read -r -p "Press Enter to exit."
    exit 1
fi
if ! cd "$AUTOTAG_DIR"; then
    echo "ERROR: Failed to change directory to $AUTOTAG_DIR" >&2
    read -r -p "Press Enter to exit."
    exit 1
fi
echo "Current directory is now: $(pwd)"
echo

echo "Launching Python API server: $PYTHON_SCRIPT_TO_RUN"

PYTHON_SCRIPT_FILENAME=$(basename "$PYTHON_SCRIPT_TO_RUN")

if [ ! -f "$PYTHON_SCRIPT_FILENAME" ]; then
    echo "ERROR: Python script '$PYTHON_SCRIPT_FILENAME' not found in current directory ($(pwd))." >&2
    echo "Expected at full path: $PYTHON_SCRIPT_TO_RUN" >&2
    read -r -p "Press Enter to exit."
    exit 1
fi

echo "Starting server using explicitly: \"$VENV_PYTHON_EXE\" \"$PYTHON_SCRIPT_FILENAME\""
echo "The browser should open automatically by the Python script."
echo "Press Ctrl+C in this window to stop the server."
echo

"$VENV_PYTHON_EXE" "$PYTHON_SCRIPT_FILENAME"

PYTHON_EXIT_CODE=$?

echo
echo "Python server has stopped (exit code: $PYTHON_EXIT_CODE)."

read -n 1 -s -r -p "Press any key to close this window..."
echo

exit $PYTHON_EXIT_CODE
