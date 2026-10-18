param([string]$BuildDirectory = "", [string]$Configuration = "Release")
$ErrorActionPreference = "Stop"
if (-not $BuildDirectory) {
    $BuildDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) "build/native"
}
& ctest --test-dir $BuildDirectory -C $Configuration --output-on-failure
if ($LASTEXITCODE -ne 0) {
    $testExitCode = $LASTEXITCODE
    # Qt on Windows may send its default test output to the debugger, not CTest.
    $coreReport = Join-Path $BuildDirectory "core-test-results.txt"
    if (Test-Path -LiteralPath $coreReport) { Get-Content -LiteralPath $coreReport }
    throw "C++ tests failed ($testExitCode)"
}
