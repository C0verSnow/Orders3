param([string]$Compiler = "g++")
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $repository "build"
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$platformLibraries = @()
if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
    $platformLibraries = @("-mwindows", "-luser32", "-lgdi32")
}
& $Compiler -std=c++17 -O2 -Wall -Wextra -Wpedantic (Join-Path $repository "native/launcher.cpp") (Join-Path $repository "native/main.cpp") -o (Join-Path $buildDirectory "orders.exe") @platformLibraries
if ($LASTEXITCODE -ne 0) { throw "C++ build failed ($LASTEXITCODE)" }
Write-Output "Built $buildDirectory/orders.exe"
