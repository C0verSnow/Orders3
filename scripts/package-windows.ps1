param(
    [string]$BuildDirectory = "build/native",
    [string]$PackageDirectory = "dist/orders-windows-x64"
)
$ErrorActionPreference = "Stop"
if (-not $env:QT_ROOT_DIR -or -not $env:VCToolsRedistDir) {
    throw "Set up Qt and the MSVC x64 developer environment before packaging"
}

& cmake --install $BuildDirectory --config Release --prefix $PackageDirectory
if ($LASTEXITCODE -ne 0) { throw "CMake install failed" }
$binaryDirectory = (Resolve-Path -LiteralPath $PackageDirectory).Path
$executable = Join-Path $binaryDirectory "orders.exe"
$coreLibrary = Join-Path $binaryDirectory "orders_core.dll"
# windeployqt follows Qt dependencies, but does not recurse through our own DLL.
# Scan both binaries and explicitly include the core library's SQL/Concurrent modules.
$deployTool = Join-Path $env:QT_ROOT_DIR "bin/windeployqt.exe"
& $deployTool --release --compiler-runtime --sql --concurrent --dir $binaryDirectory $executable $coreLibrary
if ($LASTEXITCODE -ne 0) { throw "Qt deployment failed" }

# Use the official app-local redistributable files, not DLLs from System32 or the compiler bin.
$runtimeDirectory = Get-ChildItem -LiteralPath (Join-Path $env:VCToolsRedistDir "x64") `
    -Directory -Filter "Microsoft.VC*.CRT" | Select-Object -First 1
if (-not $runtimeDirectory) { throw "MSVC x64 redistributable CRT directory not found" }
Get-ChildItem -LiteralPath $runtimeDirectory.FullName -Filter "*.dll" -File |
    Copy-Item -Destination $binaryDirectory
@"
[Paths]
Prefix=.
Plugins=.
QmlImports=qml
"@ | Set-Content -LiteralPath (Join-Path $binaryDirectory "qt.conf") -Encoding utf8

foreach ($relativePath in @(
    "orders.exe", "orders_core.dll", "Qt6Core.dll", "Qt6Network.dll", "Qt6Sql.dll",
    "Qt6Concurrent.dll", "Qt6HttpServer.dll", "Qt6Gui.dll", "Qt6Widgets.dll",
    "Qt6WebEngineCore.dll", "Qt6WebEngineWidgets.dll", "QtWebEngineProcess.exe",
    "sqldrivers/qsqlite.dll", "platforms/qwindows.dll", "tls/qschannelbackend.dll",
    "resources/icudtl.dat", "resources/qtwebengine_resources.pak",
    "translations/qtwebengine_locales/en-US.pak",
    "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $binaryDirectory $relativePath) -PathType Leaf)) {
        throw "Release package is missing $relativePath"
    }
}
Copy-Item -LiteralPath "README.md", "docs/third-party.md" -Destination $PackageDirectory
$licenseDirectory = Join-Path $env:QT_ROOT_DIR "licenses"
if (Test-Path -LiteralPath $licenseDirectory) {
    Copy-Item -LiteralPath $licenseDirectory -Destination (Join-Path $PackageDirectory "licenses") -Recurse
}
Write-Output "Packaged Windows application and runtime libraries in $PackageDirectory"
