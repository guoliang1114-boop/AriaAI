$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCmd) {
    throw "npm.cmd not found. Please install Node.js first."
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing web dependencies..."
    & $NpmCmd.Source install
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install web dependencies."
    }
}

if (-not $env:VITE_API_URL -or [string]::IsNullOrWhiteSpace($env:VITE_API_URL)) {
    $env:VITE_API_URL = "/api"
}

Write-Host "Starting AriaAI Web on http://127.0.0.1:5173"
Write-Host "API Base: $($env:VITE_API_URL)"
& $NpmCmd.Source run dev -- --host 127.0.0.1
