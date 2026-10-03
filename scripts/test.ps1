param([string]$BuildDirectory = "", [string]$Configuration = "Release")
$ErrorActionPreference = "Stop"
if (-not $BuildDirectory) {
    $BuildDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) "build/native"
}
& ctest --test-dir $BuildDirectory -C $Configuration --output-on-failure
if ($LASTEXITCODE -ne 0) { throw "C++ tests failed ($LASTEXITCODE)" }
