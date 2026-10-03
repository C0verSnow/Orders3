param([string]$Python = "python")
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
Push-Location $repository
try {
    & $Python (Join-Path $PSScriptRoot "test.py")
    if ($LASTEXITCODE -ne 0) { throw "Tests failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
