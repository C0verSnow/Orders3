param(
    [ValidateSet("Debug", "Release", "RelWithDebInfo")]
    [string]$Configuration = "Release",
    [string]$QtPrefix = "",
    [string]$BuildDirectory = ""
)
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
if (-not $BuildDirectory) { $BuildDirectory = Join-Path $repository "build/native" }
$arguments = @("-S", $repository, "-B", $BuildDirectory)
if ($QtPrefix) { $arguments += "-DCMAKE_PREFIX_PATH=$QtPrefix" }
& cmake @arguments "-DCMAKE_BUILD_TYPE=$Configuration"
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed ($LASTEXITCODE)" }
& cmake --build $BuildDirectory --config $Configuration --parallel
if ($LASTEXITCODE -ne 0) { throw "C++ build failed ($LASTEXITCODE)" }
Write-Output "Built C++ application in $BuildDirectory"
