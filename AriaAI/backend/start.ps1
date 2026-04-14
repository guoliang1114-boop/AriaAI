$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if (-not $env:DATABASE_URL -or [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    $env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/ariaai"
}

if (-not $env:ARIAAI_BACKEND_VENV -or [string]::IsNullOrWhiteSpace($env:ARIAAI_BACKEND_VENV)) {
    $env:ARIAAI_BACKEND_VENV = Join-Path $env:LOCALAPPDATA "AriaAI\backend-venv"
}

if (-not (Test-Path $env:ARIAAI_BACKEND_VENV)) {
    New-Item -ItemType Directory -Force -Path $env:ARIAAI_BACKEND_VENV | Out-Null
}

function Find-PythonLauncher {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($version in @("-3.12", "-3.11", "-3.10", "-3.9", "-3")) {
            try {
                & py $version --version *> $null
                if ($LASTEXITCODE -eq 0) {
                    return @("py", $version)
                }
            } catch {}
        }
    }

    foreach ($cmd in @("python3.12", "python3.11", "python3.10", "python3.9", "python")) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            return @($cmd)
        }
    }

    throw "Compatible Python not found. Please install Python 3.9-3.12 first."
}

if (-not (Test-Path (Join-Path $env:ARIAAI_BACKEND_VENV "Scripts\python.exe"))) {
    Write-Host "Creating Python virtual environment..."
    $launcher = Find-PythonLauncher
    & $launcher[0] @($launcher[1..($launcher.Length - 1)]) -m venv $env:ARIAAI_BACKEND_VENV
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create virtual environment."
    }
}

$Python = Join-Path $env:ARIAAI_BACKEND_VENV "Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "Virtual environment Python not found at $Python"
}

$PythonVersion = (& $Python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Failed to detect Python version from virtual environment."
}

if ($PythonVersion -notmatch '^3\.(9|10|11|12)$') {
    throw "Current .venv uses Python $PythonVersion. This backend currently requires Python 3.9-3.12 because fastembed==0.4.2 is incompatible with newer versions. Delete .venv and rerun this script with Python 3.12 installed."
}

Write-Host "Using Python: $Python"
Write-Host "Virtualenv: $($env:ARIAAI_BACKEND_VENV)"
& $Python -c "import uvicorn, fastapi, sqlmodel" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing backend dependencies..."
    & $Python -m pip install --upgrade pip -q
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip."
    }

    & $Python -m pip install -r requirements.txt -q
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed. Please confirm you are using Python 3.9-3.12 and network access is available."
    }
}

Write-Host "Starting AriaAI API on http://127.0.0.1:8000"
Write-Host "Database: $($env:DATABASE_URL)"
if ($env:ARIAAI_RELOAD -eq "1") {
    Write-Host "Reload: enabled"
    & $Python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
} else {
    Write-Host "Reload: disabled (set ARIAAI_RELOAD=1 to enable)"
    & $Python -m uvicorn main:app --host 127.0.0.1 --port 8000
}
