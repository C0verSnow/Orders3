param([string]$Compiler = "g++")
$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $repository "build"
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
& $Compiler -std=c++17 -O2 -Wall -Wextra -Wpedantic (Join-Path $repository "native/launcher.cpp") (Join-Path $repository "native/main.cpp") -o (Join-Path $buildDirectory "orders.exe")
if ($LASTEXITCODE -ne 0) { throw "C++ build failed ($LASTEXITCODE)" }
Write-Output "Built $buildDirectory/orders.exe"
