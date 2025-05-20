
$ScriptRoot = $PSScriptRoot
$AutotagDir = Join-Path -Path $ScriptRoot -ChildPath "autotag"
$VenvDir = Join-Path -Path $AutotagDir -ChildPath ".venv"
$RequirementsFile = Join-Path -Path $AutotagDir -ChildPath "requirements.txt"
$PythonScriptToRun = Join-Path -Path $AutotagDir -ChildPath "api.py"
$PythonExecutable = "python"

Write-Host "Script started from: $ScriptRoot"
Set-Location -Path $ScriptRoot

Write-Host "Checking for virtual environment in '$VenvDir'..."
if (-not (Test-Path -Path $VenvDir -PathType Container)) {
    Write-Host "Virtual environment not found. Creating it now..."
    try {
        & $PythonExecutable -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create virtual environment. Exit code: $LASTEXITCODE"
        }
        Write-Host "Virtual environment created successfully in '$VenvDir'."
    }
    catch {
        Write-Error "Error creating virtual environment: $($_.Exception.Message)"
        Write-Host "Please ensure '$PythonExecutable' (Python 3.3+) is installed and in your PATH."
        exit 1
    }
} else {
    Write-Host "Virtual environment found."
}

$VenvActivateScript = Join-Path -Path $VenvDir -ChildPath "Scripts\Activate.ps1"
Write-Host "Attempting to activate virtual environment using '$VenvActivateScript'..."
if (Test-Path -Path $VenvActivateScript) {
    try {
        . $VenvActivateScript
        Write-Host "Virtual environment activated."
    }
    catch {
        Write-Error "Error activating virtual environment: $($_.Exception.Message)"
        Write-Host "The activation script might have issues or PowerShell security policy might be restrictive."
        exit 1
    }
} else {
    Write-Error "Virtual environment activation script not found at '$VenvActivateScript'."
    Write-Host "The virtual environment might not have been created correctly."
    exit 1
}

Write-Host "Installing dependencies from '$RequirementsFile'..."
if (-not (Test-Path -Path $RequirementsFile -PathType Leaf)) {
    Write-Error "Requirements file not found at '$RequirementsFile'."
    exit 1
}

try {
    pip install -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install dependencies. Pip exit code: $LASTEXITCODE"
    }
    Write-Host "Dependencies installed successfully."
}
catch {
    Write-Error "Error installing dependencies: $($_.Exception.Message)"
    exit 1
}

Write-Host "Running Python script: '$PythonScriptToRun'..."
if (-not (Test-Path -Path $PythonScriptToRun -PathType Leaf)) {
    Write-Error "Python script not found at '$PythonScriptToRun'."
    exit 1
}

try {
    & python $PythonScriptToRun @Args
    Write-Host "Python script finished. Exit code: $LASTEXITCODE"
}
catch {
    Write-Error "Error running Python script: $($_.Exception.Message)"
    Write-Host "Python script exit code (if available before error): $LASTEXITCODE"
    exit 1
}

Write-Host "Script execution complete."
exit $LASTEXITCODE